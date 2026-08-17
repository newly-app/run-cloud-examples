package cloud.run.examples.screenshot;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Typeface;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.nio.ByteBuffer;
import java.util.HashSet;
import java.util.Set;

final class MediaProofController {
    private static final int CAMERA_PERMISSION_REQUEST = 9101;
    private static final int MICROPHONE_PERMISSION_REQUEST = 9102;
    private static final String CAMERA_FINGERPRINT = "RCAM-v1:RGBY";
    private static final String AUDIO_FINGERPRINT = "RAUD-v1:1000Hz";
    private static final int AUDIO_SAMPLE_RATE = 48_000;

    enum Mode {
        CAMERA,
        MICROPHONE
    }

    static final class Request {
        final Mode mode;
        final String attempt;

        private Request(Mode mode, String attempt) {
            this.mode = mode;
            this.attempt = attempt;
        }

        static Request from(Intent intent) {
            Uri uri = intent == null ? null : intent.getData();
            if (uri == null || !"runcloudproof".equalsIgnoreCase(uri.getScheme())) return null;
            String component = uri.getHost();
            if ("media".equalsIgnoreCase(component)) {
                component = uri.getLastPathSegment();
            }
            Mode mode;
            if ("camera".equalsIgnoreCase(component)) mode = Mode.CAMERA;
            else if ("microphone".equalsIgnoreCase(component)) mode = Mode.MICROPHONE;
            else return null;
            return new Request(mode, safeAttempt(uri.getQueryParameter("attempt")));
        }

        private static String safeAttempt(String value) {
            if (value == null) return "unspecified";
            String result = value.replaceAll("[^A-Za-z0-9._-]", "-");
            if (result.length() > 48) result = result.substring(0, 48);
            return result.isEmpty() ? "unspecified" : result;
        }
    }

    private final Activity activity;
    private final Request request;
    private TextView status;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private CameraDevice cameraDevice;
    private CameraCaptureSession cameraSession;
    private ImageReader imageReader;
    private int observedCameraFrames;
    private int matchingCameraFrames;
    private boolean cameraPassed;
    private String cameraChromaLayout = "uv";
    private AudioRecord audioRecord;
    private Thread audioThread;
    private volatile boolean microphonePassed;
    private volatile boolean stopped;

    MediaProofController(Activity activity, Request request) {
        this.activity = activity;
        this.request = request;
    }

    void start() {
        stopped = false;
        activity.getWindow().setStatusBarColor(Color.rgb(5, 18, 25));
        activity.getWindow().setNavigationBarColor(Color.rgb(7, 31, 39));

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.setPadding(dp(24), dp(24), dp(24), dp(24));
        content.setBackgroundColor(Color.rgb(5, 18, 25));

        TextView title = text(
            request.mode == Mode.CAMERA
                ? "run.cloud camera injection proof"
                : "run.cloud microphone injection proof",
            21,
            Typeface.BOLD,
            Color.rgb(117, 232, 250)
        );
        title.setContentDescription("media-proof-title");
        content.addView(title, wrap());
        content.addView(space(22));

        status = text("", 16, Typeface.BOLD, Color.WHITE);
        status.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        status.setGravity(Gravity.CENTER_VERTICAL);
        status.setPadding(dp(16), dp(16), dp(16), dp(16));
        status.setBackgroundColor(Color.rgb(20, 56, 69));
        status.setMinHeight(dp(132));
        status.setFocusable(true);
        content.addView(status, wrap());
        content.addView(space(22));

        TextView expectation = text(
            request.mode == Mode.CAMERA
                ? "Expected four solid quadrants: red, green, blue, and yellow."
                : "Expected mono PCM tone centered at 1000 Hz.",
            14,
            Typeface.NORMAL,
            Color.rgb(195, 218, 226)
        );
        expectation.setContentDescription("media-proof-expectation");
        content.addView(expectation, wrap());
        activity.setContentView(content);

        showStatus(request.mode.name() + " ARMED attempt=" + request.attempt);
        if (request.mode == Mode.CAMERA) authorizeCamera();
        else authorizeMicrophone();
    }

    void onRequestPermissionsResult(int requestCode, int[] grantResults) {
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            if (granted) startCamera();
            else fail("CAMERA", "permission-denied");
        } else if (requestCode == MICROPHONE_PERMISSION_REQUEST) {
            if (granted) startMicrophone();
            else fail("MICROPHONE", "permission-denied");
        }
    }

    void stop() {
        stopped = true;
        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (IllegalStateException ignored) {
                // It may already have stopped during an activity transition.
            }
            audioRecord.release();
            audioRecord = null;
        }
        if (audioThread != null) audioThread.interrupt();
        audioThread = null;
        if (cameraSession != null) cameraSession.close();
        cameraSession = null;
        if (cameraDevice != null) cameraDevice.close();
        cameraDevice = null;
        if (imageReader != null) imageReader.close();
        imageReader = null;
        if (cameraThread != null) cameraThread.quitSafely();
        cameraThread = null;
        cameraHandler = null;
    }

    private void authorizeCamera() {
        if (activity.checkSelfPermission(Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED) {
            startCamera();
            return;
        }
        showStatus("CAMERA PERMISSION attempt=" + request.attempt);
        activity.requestPermissions(
            new String[] { Manifest.permission.CAMERA },
            CAMERA_PERMISSION_REQUEST
        );
    }

    private void startCamera() {
        cameraThread = new HandlerThread("run-cloud-media-camera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
        CameraManager manager = (CameraManager) activity.getSystemService(Activity.CAMERA_SERVICE);
        if (manager == null) {
            fail("CAMERA", "manager-unavailable");
            return;
        }
        try {
            String cameraId = preferredCamera(manager);
            if (cameraId == null) {
                fail("CAMERA", "device-unavailable");
                return;
            }
            imageReader = ImageReader.newInstance(640, 480, ImageFormat.YUV_420_888, 3);
            imageReader.setOnImageAvailableListener(this::readCameraImage, cameraHandler);
            if (activity.checkSelfPermission(Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
                fail("CAMERA", "permission-denied");
                return;
            }
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice opened) {
                    if (stopped) {
                        opened.close();
                        return;
                    }
                    cameraDevice = opened;
                    configureCameraSession();
                }

                @Override
                public void onDisconnected(CameraDevice disconnected) {
                    disconnected.close();
                    fail("CAMERA", "disconnected");
                }

                @Override
                public void onError(CameraDevice failedDevice, int error) {
                    failedDevice.close();
                    fail("CAMERA", "device-error-" + error);
                }
            }, cameraHandler);
        } catch (CameraAccessException | IllegalArgumentException error) {
            fail("CAMERA", "setup-" + error.getClass().getSimpleName());
        }
    }

    private String preferredCamera(CameraManager manager) throws CameraAccessException {
        String fallback = null;
        for (String id : manager.getCameraIdList()) {
            if (fallback == null) fallback = id;
            Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) return id;
        }
        return fallback;
    }

    private void configureCameraSession() {
        if (cameraDevice == null || imageReader == null) return;
        try {
            CaptureRequest.Builder requestBuilder = cameraDevice.createCaptureRequest(
                CameraDevice.TEMPLATE_PREVIEW
            );
            requestBuilder.addTarget(imageReader.getSurface());
            cameraDevice.createCaptureSession(
                java.util.Collections.singletonList(imageReader.getSurface()),
                new CameraCaptureSession.StateCallback() {
                    @Override
                    public void onConfigured(CameraCaptureSession configured) {
                        if (stopped) {
                            configured.close();
                            return;
                        }
                        cameraSession = configured;
                        try {
                            configured.setRepeatingRequest(requestBuilder.build(), null, cameraHandler);
                            showStatus(
                                "CAMERA READY " + CAMERA_FINGERPRINT + " attempt=" + request.attempt
                            );
                        } catch (CameraAccessException error) {
                            fail("CAMERA", "capture-start");
                        }
                    }

                    @Override
                    public void onConfigureFailed(CameraCaptureSession failed) {
                        fail("CAMERA", "capture-configure");
                    }
                },
                cameraHandler
            );
        } catch (CameraAccessException error) {
            fail("CAMERA", "capture-request");
        }
    }

    private void readCameraImage(ImageReader reader) {
        Image image = reader.acquireLatestImage();
        if (image == null) return;
        try {
            observedCameraFrames += 1;
            Set<String> colors = cameraColors(image);
            if (colors.size() == 4
                && colors.contains("R")
                && colors.contains("G")
                && colors.contains("B")
                && colors.contains("Y")) {
                matchingCameraFrames += 1;
            } else {
                matchingCameraFrames = 0;
            }
            if (!cameraPassed && matchingCameraFrames >= 3) {
                cameraPassed = true;
                showStatus(
                    "CAMERA PASS " + CAMERA_FINGERPRINT + " attempt=" + request.attempt
                        + " frames=" + observedCameraFrames + " matches=" + matchingCameraFrames
                        + " layout=" + cameraChromaLayout
                );
            } else if (!cameraPassed && observedCameraFrames % 10 == 0) {
                showStatus(
                    "CAMERA READY " + CAMERA_FINGERPRINT + " attempt=" + request.attempt
                        + " frames=" + observedCameraFrames + " matches=" + matchingCameraFrames
                        + " colors=" + colorSummary(colors) + " layout=" + cameraChromaLayout
                );
            }
        } finally {
            image.close();
        }
    }

    private String colorSummary(Set<String> colors) {
        StringBuilder result = new StringBuilder();
        for (String color : new String[] { "R", "G", "B", "Y" }) {
            if (colors.contains(color)) result.append(color);
        }
        return result.length() == 0 ? "none" : result.toString();
    }

    private Set<String> cameraColors(Image image) {
        Set<String> uvColors = cameraColors(image, 1, 2);
        Set<String> vuColors = cameraColors(image, 2, 1);
        if (vuColors.size() > uvColors.size()) {
            cameraChromaLayout = "vu";
            return vuColors;
        }
        cameraChromaLayout = "uv";
        return uvColors;
    }

    private Set<String> cameraColors(Image image, int uPlaneIndex, int vPlaneIndex) {
        int[] fractions = new int[] { 5, 20, 35, 50, 65, 80, 95 };
        Set<String> result = new HashSet<>();
        for (int yFraction : fractions) {
            for (int xFraction : fractions) {
                String color = classify(averageRgb(
                    image,
                    Math.min(image.getWidth() - 1, image.getWidth() * xFraction / 100),
                    Math.min(image.getHeight() - 1, image.getHeight() * yFraction / 100),
                    uPlaneIndex,
                    vPlaneIndex
                ));
                if (color != null) result.add(color);
            }
        }
        return result;
    }

    private double[] averageRgb(
        Image image,
        int centerX,
        int centerY,
        int uPlaneIndex,
        int vPlaneIndex
    ) {
        Image.Plane[] planes = image.getPlanes();
        Image.Plane uPlane = planes[uPlaneIndex];
        Image.Plane vPlane = planes[vPlaneIndex];
        ByteBuffer yBuffer = planes[0].getBuffer();
        ByteBuffer uBuffer = uPlane.getBuffer();
        ByteBuffer vBuffer = vPlane.getBuffer();
        int radius = Math.max(2, Math.min(image.getWidth(), image.getHeight()) / 48);
        double red = 0;
        double green = 0;
        double blue = 0;
        int samples = 0;
        for (int y = Math.max(0, centerY - radius);
             y <= Math.min(image.getHeight() - 1, centerY + radius);
             y += 2) {
            for (int x = Math.max(0, centerX - radius);
                 x <= Math.min(image.getWidth() - 1, centerX + radius);
                 x += 2) {
                int yValue = unsigned(yBuffer.get(y * planes[0].getRowStride()
                    + x * planes[0].getPixelStride()));
                int chromaX = x / 2;
                int chromaY = y / 2;
                int uValue = unsigned(uBuffer.get(chromaY * uPlane.getRowStride()
                    + chromaX * uPlane.getPixelStride()));
                int vValue = unsigned(vBuffer.get(chromaY * vPlane.getRowStride()
                    + chromaX * vPlane.getPixelStride()));
                double[] rgb = yuvToRgb(yValue, uValue, vValue);
                red += rgb[0];
                green += rgb[1];
                blue += rgb[2];
                samples += 1;
            }
        }
        return new double[] { red / samples, green / samples, blue / samples };
    }

    private int unsigned(byte value) {
        return value & 0xff;
    }

    private double[] yuvToRgb(int y, int u, int v) {
        int c = Math.max(0, y - 16);
        int d = u - 128;
        int e = v - 128;
        return new double[] {
            clamp((298 * c + 409 * e + 128) >> 8),
            clamp((298 * c - 100 * d - 208 * e + 128) >> 8),
            clamp((298 * c + 516 * d + 128) >> 8),
        };
    }

    private double clamp(int value) {
        return Math.max(0, Math.min(255, value));
    }

    private String classify(double[] color) {
        double red = color[0];
        double green = color[1];
        double blue = color[2];
        if (red > 110 && green > 105 && blue < Math.min(red, green) * 0.65) return "Y";
        if (red > 100 && red > green * 1.45 && red > blue * 1.45) return "R";
        if (green > 85 && green > red * 1.35 && green > blue * 1.35) return "G";
        if (blue > 100 && blue > red * 1.45 && blue > green * 1.45) return "B";
        return null;
    }

    private void authorizeMicrophone() {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) {
            startMicrophone();
            return;
        }
        showStatus("MICROPHONE PERMISSION attempt=" + request.attempt);
        activity.requestPermissions(
            new String[] { Manifest.permission.RECORD_AUDIO },
            MICROPHONE_PERMISSION_REQUEST
        );
    }

    private void startMicrophone() {
        int minimum = AudioRecord.getMinBufferSize(
            AUDIO_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minimum <= 0) {
            fail("MICROPHONE", "buffer-size-" + minimum);
            return;
        }
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            fail("MICROPHONE", "permission-denied");
            return;
        }
        int bufferBytes = Math.max(minimum, 4096 * 2);
        audioRecord = new AudioRecord(
            MediaRecorder.AudioSource.MIC,
            AUDIO_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferBytes
        );
        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            fail("MICROPHONE", "not-initialized");
            audioRecord.release();
            audioRecord = null;
            return;
        }
        try {
            audioRecord.startRecording();
        } catch (IllegalStateException error) {
            fail("MICROPHONE", "record-start");
            return;
        }
        showStatus(
            "MICROPHONE READY " + AUDIO_FINGERPRINT + " attempt=" + request.attempt
                + " rate=" + AUDIO_SAMPLE_RATE
        );
        audioThread = new Thread(this::readMicrophone, "run-cloud-media-microphone");
        audioThread.start();
    }

    private void readMicrophone() {
        short[] samples = new short[4096];
        ToneAnalyzer analyzer = new ToneAnalyzer(AUDIO_SAMPLE_RATE);
        while (!stopped && audioRecord != null) {
            int count = audioRecord.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
            if (count < 0) {
                fail("MICROPHONE", "read-" + count);
                return;
            }
            if (count == 0) continue;
            ToneAnalyzer.Observation observation = analyzer.observe(samples, count);
            if (!microphonePassed && observation.matchedWindows >= 3) {
                microphonePassed = true;
                showStatus(
                    "MICROPHONE PASS " + AUDIO_FINGERPRINT + " attempt=" + request.attempt
                        + " samples=" + observation.samples + " rate=" + AUDIO_SAMPLE_RATE
                        + " measured=" + Math.round(observation.measuredHz) + "Hz"
                );
            }
        }
    }

    private void showStatus(String value) {
        activity.runOnUiThread(() -> {
            if (status == null || stopped) return;
            status.setText(value);
            status.setContentDescription("media-proof-status " + value);
        });
    }

    private void fail(String input, String code) {
        showStatus(input + " FAIL code=" + code + " attempt=" + request.attempt);
    }

    private TextView text(String value, int size, int style, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.MONOSPACE, style);
        return view;
    }

    private TextView space(int height) {
        TextView view = new TextView(activity);
        view.setHeight(dp(height));
        return view;
    }

    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private static final class ToneAnalyzer {
        private final double sampleRate;
        private int totalSamples;
        private int windows;
        private int matchedWindows;

        ToneAnalyzer(double sampleRate) {
            this.sampleRate = sampleRate;
        }

        Observation observe(short[] samples, int count) {
            totalSamples += count;
            windows += 1;
            double energy = 0;
            double targetReal = 0;
            double targetImaginary = 0;
            double referenceReal = 0;
            double referenceImaginary = 0;
            int crossings = 0;
            double previous = samples[0] / 32768.0;
            for (int index = 0; index < count; index += 1) {
                double value = samples[index] / 32768.0;
                energy += value * value;
                double targetPhase = 2 * Math.PI * 1_000 * index / sampleRate;
                targetReal += value * Math.cos(targetPhase);
                targetImaginary -= value * Math.sin(targetPhase);
                double referencePhase = 2 * Math.PI * 713 * index / sampleRate;
                referenceReal += value * Math.cos(referencePhase);
                referenceImaginary -= value * Math.sin(referencePhase);
                if (index > 0 && ((previous < 0 && value >= 0) || (previous >= 0 && value < 0))) {
                    crossings += 1;
                }
                previous = value;
            }
            double rms = Math.sqrt(energy / count);
            double target = 2 * Math.hypot(targetReal, targetImaginary) / count;
            double reference = 2 * Math.hypot(referenceReal, referenceImaginary) / count;
            double measured = crossings * sampleRate / (2.0 * count);
            if (rms > 0.08 && target > 0.15 && target > reference * 4
                && measured >= 920 && measured <= 1_080) {
                matchedWindows += 1;
            } else {
                matchedWindows = 0;
            }
            return new Observation(totalSamples, windows, matchedWindows, measured, rms);
        }

        private static final class Observation {
            final int samples;
            final int windows;
            final int matchedWindows;
            final double measuredHz;
            final double rms;

            Observation(int samples, int windows, int matchedWindows, double measuredHz, double rms) {
                this.samples = samples;
                this.windows = windows;
                this.matchedWindows = matchedWindows;
                this.measuredHz = measuredHz;
                this.rms = rms;
            }
        }
    }
}
