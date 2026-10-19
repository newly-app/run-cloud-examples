package cloud.run.examples.screenshot;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.Choreographer;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;

/** Native wall-clock pixels and an independently accessible input counter. */
final class MoqProofView extends LinearLayout {
    private int count;
    private final Button target;

    MoqProofView(Context context) {
        super(context);
        setOrientation(VERTICAL);
        setBackgroundColor(Color.BLACK);
        target = new Button(context);
        target.setTextColor(Color.WHITE);
        target.setTextSize(16);
        target.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        target.setAllCaps(false);
        target.setOnClickListener(view -> { count += 1; updateTarget(); });
        addView(target, new LayoutParams(LayoutParams.MATCH_PARENT, dp(42)));
        BinaryClock clock = new BinaryClock(context);
        LayoutParams clockLayout = new LayoutParams(LayoutParams.MATCH_PARENT, dp(24));
        clockLayout.topMargin = dp(4);
        addView(clock, clockLayout);
        updateTarget();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void updateTarget() {
        target.setText("MoQ taps: " + count);
        target.setContentDescription("moq-tap-target: " + count);
        target.setBackgroundColor(new int[] {
            Color.rgb(0, 122, 255), Color.rgb(255, 59, 48), Color.rgb(52, 199, 89)
        }[count % 3]);
    }

    private static final class BinaryClock extends View implements Choreographer.FrameCallback {
        private final Paint paint = new Paint();
        private boolean ticking;

        BinaryClock(Context context) {
            super(context);
            setContentDescription("moq-clock: 36-bit wall milliseconds modulo 68719476736");
            paint.setAntiAlias(false);
        }

        @Override protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            ticking = true;
            Choreographer.getInstance().postFrameCallback(this);
        }

        @Override protected void onDetachedFromWindow() {
            ticking = false;
            Choreographer.getInstance().removeFrameCallback(this);
            super.onDetachedFromWindow();
        }

        @Override public void doFrame(long frameTimeNanos) {
            if (!ticking) return;
            invalidate();
            Choreographer.getInstance().postFrameCallback(this);
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            canvas.drawColor(Color.BLACK);
            long value = System.currentTimeMillis() & ((1L << 36) - 1);
            paint.setColor(Color.WHITE);
            float cell = getWidth() / 42f;
            for (int index = 0; index < 42; index++) {
                boolean white = index == 1 || index == 39 || index == 41
                    || (index >= 3 && index < 39 && ((value >>> (38 - index)) & 1) != 0);
                if (white) canvas.drawRect(index * cell, 0, (index + 1) * cell, getHeight(), paint);
            }
        }
    }
}
