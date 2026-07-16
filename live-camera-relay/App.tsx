import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { joinRoom, type Room } from 'trystero';

type DemoRole = 'broadcaster' | 'receiver';
type MediaState = 'idle' | 'requesting' | 'ready' | 'waiting' | 'live' | 'error';

const APP_ID = 'run-cloud-live-camera-relay-v1';
const ROOM_PATTERN = /^[a-z0-9-]{8,80}$/i;

function demoParameters(): { role: DemoRole; roomId: string; receiver: number } {
  if (typeof window === 'undefined') {
    return { role: 'receiver', roomId: 'run-cloud-preview', receiver: 1 };
  }

  const params = new URLSearchParams(window.location.search);
  const room = params.get('room') ?? '';
  const receiver = Number(params.get('receiver'));
  return {
    role: params.get('role') === 'broadcaster' ? 'broadcaster' : 'receiver',
    roomId: ROOM_PATTERN.test(room) ? room : 'run-cloud-preview',
    receiver: Number.isInteger(receiver) && receiver > 0 ? receiver : 1,
  };
}

function VideoSurface({
  stream,
  muted,
  label,
}: {
  stream: MediaStream;
  muted: boolean;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return <video
    ref={ref}
    autoPlay
    muted={muted}
    playsInline
    aria-label={label}
    style={styles.video as React.CSSProperties}
  />;
}

function Waveform({
  stream,
  audioContextRef,
}: {
  stream: MediaStream | null;
  audioContextRef: React.MutableRefObject<AudioContext | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasAudio = Boolean(stream?.getAudioTracks().length);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audioContext = stream && hasAudio && AudioContextClass ? new AudioContextClass() : null;
    audioContextRef.current = audioContext;
    const analyser = audioContext ? audioContext.createAnalyser() : null;
    const source = audioContext && analyser && stream
      ? audioContext.createMediaStreamSource(stream)
      : null;
    if (analyser) {
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      source?.connect(analyser);
    }
    const samples = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let frame = 0;

    const draw = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#070b0c';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = hasAudio ? '#67e8f9' : '#475569';
      context.lineWidth = 2;
      context.beginPath();

      if (analyser && samples) analyser.getByteTimeDomainData(samples);
      const count = samples?.length ?? 64;
      for (let index = 0; index < count; index += 1) {
        const x = count === 1 ? 0 : (index / (count - 1)) * width;
        const sample = samples ? (samples[index] - 128) / 128 : 0;
        const y = height / 2 + sample * height * 0.38;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      source?.disconnect();
      void audioContext?.close();
      if (audioContextRef.current === audioContext) audioContextRef.current = null;
    };
  }, [audioContextRef, hasAudio, stream]);

  return (
    <View style={styles.waveformSection}>
      <View style={styles.waveformHeading}>
        <Text style={styles.label}>AUDIO TRACK</Text>
        <Text style={[styles.trackState, hasAudio ? styles.trackLive : styles.trackAbsent]}>
          {hasAudio ? 'RECEIVING' : 'NO TRACK'}
        </Text>
      </View>
      <canvas
        ref={canvasRef}
        aria-label={hasAudio ? 'Live audio waveform' : 'No audio track waveform'}
        style={styles.waveform as React.CSSProperties}
      />
    </View>
  );
}

function stateLabel(state: MediaState): string {
  if (state === 'requesting') return 'OPENING CAMERA';
  if (state === 'ready') return 'CAMERA READY';
  if (state === 'waiting') return 'WAITING FOR SOURCE';
  if (state === 'live') return 'LIVE';
  if (state === 'error') return 'ERROR';
  return 'READY';
}

export default function App() {
  const params = useMemo(demoParameters, []);
  const [mediaState, setMediaState] = useState<MediaState>(
    params.role === 'broadcaster' ? 'idle' : 'waiting',
  );
  const [error, setError] = useState<string | null>(null);
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [receiverMuted, setReceiverMuted] = useState(true);
  const roomRef = useRef<Room | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const room = joinRoom(
      { appId: APP_ID },
      params.roomId,
      {
        onJoinError: ({ error: message }) => {
          setError(message);
          setMediaState('error');
        },
      },
    );
    roomRef.current = room;
    room.onPeerJoin = (peerId) => {
      setPeerIds((current) => current.includes(peerId) ? current : [...current, peerId]);
      const stream = localStreamRef.current;
      if (params.role === 'broadcaster' && stream) {
        void Promise.allSettled(room.addStream(stream, { target: peerId }));
      }
    };
    room.onPeerLeave = (peerId) => {
      setPeerIds((current) => current.filter((candidate) => candidate !== peerId));
    };
    room.onPeerStream = (stream) => {
      if (params.role !== 'receiver') return;
      setRemoteStream(stream);
      setMediaState('live');
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          setRemoteStream((current) => current === stream ? null : current);
          setMediaState('waiting');
        }, { once: true });
      }
    };

    return () => {
      roomRef.current = null;
      void room.leave();
    };
  }, [params.role, params.roomId]);

  useEffect(() => () => {
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
  }, []);

  const startBroadcast = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is unavailable in this browser.');
      setMediaState('error');
      return;
    }

    setError(null);
    setMediaState('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch (withAudioError) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (videoError) {
        setError(videoError instanceof Error ? videoError.message : String(withAudioError));
        setMediaState('error');
        return;
      }
    }

    const previousStream = localStreamRef.current;
    if (previousStream) roomRef.current?.removeStream(previousStream);
    for (const track of previousStream?.getTracks() ?? []) track.stop();
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMediaState('ready');
    const sends = roomRef.current?.addStream(stream) ?? [];
    void Promise.allSettled(sends);
  }, []);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.unsupported}>
        <Text style={styles.title}>Open this example with Expo Web.</Text>
      </View>
    );
  }

  const roleName = params.role === 'broadcaster'
    ? 'BROADCASTER'
    : `RECEIVER ${String(params.receiver).padStart(2, '0')}`;
  const stream = params.role === 'broadcaster' ? localStream : remoteStream;
  const isLive = params.role === 'broadcaster'
    ? Boolean(localStream)
    : mediaState === 'live';

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark} />
          <View>
            <Text style={styles.brand}>run.cloud</Text>
            <Text style={styles.role}>{roleName}</Text>
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, isLive ? styles.statusDotLive : null]} />
          <Text style={[styles.status, isLive ? styles.statusLive : null]}>
            {stateLabel(mediaState)}
          </Text>
        </View>
      </View>

      <View style={styles.stage}>
        {stream ? (
          <VideoSurface
            stream={stream}
            muted={params.role === 'broadcaster' || receiverMuted}
            label={params.role === 'broadcaster' ? 'Local camera preview' : 'Remote camera stream'}
          />
        ) : (
          <View style={styles.placeholder}>
            {mediaState === 'requesting' ? <ActivityIndicator color="#67e8f9" size="large" /> : null}
            <Text style={styles.placeholderTitle}>
              {params.role === 'broadcaster' ? 'CAMERA STANDBY' : 'SOURCE STANDBY'}
            </Text>
            <Text style={styles.placeholderText}>
              {params.role === 'broadcaster'
                ? 'Start the camera to publish this simulator feed.'
                : 'The video feed appears when the broadcaster starts.'}
            </Text>
          </View>
        )}

        <View style={styles.stageLabel}>
          <Text style={styles.label}>ROOM</Text>
          <Text numberOfLines={1} style={styles.roomId}>{params.roomId}</Text>
        </View>
      </View>

      {params.role === 'receiver' ? (
        <Waveform stream={remoteStream} audioContextRef={audioContextRef} />
      ) : null}

      <View style={styles.footer}>
        <View>
          <Text style={styles.label}>PEERS</Text>
          <Text style={styles.footerValue}>{peerIds.length}</Text>
        </View>
        {params.role === 'broadcaster' ? (
          <Pressable
            accessibilityRole="button"
            disabled={mediaState === 'requesting'}
            onPress={() => void startBroadcast()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.buttonPressed : null,
              mediaState === 'requesting' ? styles.buttonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {localStream ? 'Restart camera' : 'Start camera'}
            </Text>
          </Pressable>
        ) : remoteStream?.getAudioTracks().length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (receiverMuted) void audioContextRef.current?.resume();
              setReceiverMuted((current) => !current);
            }}
            style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.secondaryButtonText}>
              {receiverMuted ? 'Enable audio' : 'Mute audio'}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.transportBadge}>
            <Text style={styles.transportText}>WEBRTC DIRECT</Text>
          </View>
        )}
      </View>

      {error ? (
        <View style={styles.errorBar}>
          <Text numberOfLines={2} style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: '#030505',
    color: '#f8fafc',
  },
  header: {
    height: 68,
    paddingHorizontal: 18,
    borderBottomColor: '#243034',
    borderBottomWidth: 1,
    backgroundColor: '#070a0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: {
    width: 25,
    height: 16,
    borderColor: '#67e8f9',
    borderWidth: 2,
    transform: [{ skewX: '-18deg' }],
  },
  brand: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  role: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 10, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#64748b' },
  statusDotLive: { backgroundColor: '#bef264' },
  status: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 10 },
  statusLive: { color: '#bef264' },
  stage: { flex: 1, minHeight: 0, position: 'relative', backgroundColor: '#020303' },
  video: { width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#020303' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 28,
  },
  placeholderTitle: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 15 },
  placeholderText: {
    maxWidth: 310,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  stageLabel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 43,
    borderColor: '#334155',
    borderWidth: 1,
    backgroundColor: 'rgba(3, 5, 5, 0.84)',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  label: { color: '#64748b', fontFamily: 'monospace', fontSize: 9 },
  roomId: { color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11, marginTop: 2 },
  waveformSection: {
    height: 112,
    borderTopColor: '#243034',
    borderTopWidth: 1,
    backgroundColor: '#070b0c',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  waveformHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  trackState: { fontFamily: 'monospace', fontSize: 9 },
  trackLive: { color: '#67e8f9' },
  trackAbsent: { color: '#64748b' },
  waveform: { width: '100%', height: 62 },
  footer: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopColor: '#243034',
    borderTopWidth: 1,
    backgroundColor: '#070a0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerValue: { color: '#f8fafc', fontFamily: 'monospace', fontSize: 17, marginTop: 2 },
  primaryButton: {
    minWidth: 130,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 4,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#020617', fontSize: 13, fontWeight: '700' },
  secondaryButton: {
    height: 40,
    paddingHorizontal: 15,
    borderRadius: 4,
    borderColor: '#475569',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  buttonPressed: { opacity: 0.72 },
  buttonDisabled: { opacity: 0.5 },
  transportBadge: { borderColor: '#334155', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  transportText: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 9 },
  errorBar: {
    borderTopColor: '#7f1d1d',
    borderTopWidth: 1,
    backgroundColor: '#2b0b0d',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { color: '#fecdd3', fontSize: 11, lineHeight: 16 },
  unsupported: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#030505',
    padding: 24,
  },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700', textAlign: 'center' },
});
