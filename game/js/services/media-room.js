const MEDIA_TYPES = new Set([
  'media-ready',
  'webrtc-offer',
  'webrtc-answer',
  'webrtc-ice',
  'webrtc-bye'
]);

const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }
]);

function plainDescription(description) {
  if (!description) return null;
  return { type: description.type, sdp: description.sdp };
}

function plainCandidate(candidate) {
  if (!candidate) return null;
  if (typeof candidate.toJSON === 'function') return candidate.toJSON();
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment
  };
}

function validIceUrl(value) {
  return /^(stun|stuns|turn|turns):[^\s]+$/i.test(String(value || ''));
}

export function sanitizeIceServers(input) {
  if (!Array.isArray(input)) return [...DEFAULT_ICE_SERVERS];
  const clean = [];
  for (const item of input.slice(0, 8)) {
    const urls = (Array.isArray(item?.urls) ? item.urls : [item?.urls])
      .map((value) => String(value || '').trim())
      .filter(validIceUrl)
      .slice(0, 8);
    if (!urls.length) continue;
    const server = { urls };
    if (urls.some((url) => /^turns?:/i.test(url))) {
      if (!item?.username || !item?.credential) continue;
      server.username = String(item.username).slice(0, 512);
      server.credential = String(item.credential).slice(0, 1024);
    }
    clean.push(server);
  }
  return clean.length ? clean : [...DEFAULT_ICE_SERVERS];
}

export async function loadIceServers({ accessToken = '', fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken || typeof fetchImpl !== 'function') return [...DEFAULT_ICE_SERVERS];
  try {
    const response = await fetchImpl('/api/turn-credentials', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store'
    });
    if (!response.ok) return [...DEFAULT_ICE_SERVERS];
    const payload = await response.json();
    return sanitizeIceServers(payload?.iceServers);
  } catch {
    return [...DEFAULT_ICE_SERVERS];
  }
}

export function isMediaSignal(message) {
  return !!message && MEDIA_TYPES.has(message.type);
}

export function createMediaRoom({
  selfId,
  send,
  getAccessToken = () => '',
  onRemoteStream,
  onPeerState,
  onError,
  fetchImpl = globalThis.fetch,
  peerConnectionFactory = (config) => new RTCPeerConnection(config)
}) {
  const localId = String(selfId || '').trim();
  if (!localId) throw new Error('MEDIA_SELF_ID_REQUIRED');
  if (typeof send !== 'function') throw new Error('MEDIA_SIGNAL_SENDER_REQUIRED');

  const peers = new Map();
  const localStreams = new Map();
  const remoteStreams = new Map();
  const sourceAudiences = new Map();
  const sourceAudienceKeys = new Map();
  let closed = false;
  let iceServersPromise = null;

  function report(error, context = 'media') {
    onError?.(error, context);
  }

  function iceServers() {
    if (!iceServersPromise) {
      iceServersPromise = Promise.resolve(getAccessToken())
        .then((accessToken) => loadIceServers({ accessToken, fetchImpl }))
        .catch(() => [...DEFAULT_ICE_SERVERS]);
    }
    return iceServersPromise;
  }

  function peerMedia(peer) {
    return peer.pc.getTransceivers().flatMap((transceiver) => {
      const source = peer.senderSources.get(transceiver.sender);
      const kind = peer.senderKinds.get(transceiver.sender) || transceiver.sender?.track?.kind;
      if (!source || !kind || !transceiver.mid) return [];
      return [{ mid: transceiver.mid, source, kind }];
    });
  }

  function sourceAllowed(peerId, source) {
    const audience = sourceAudiences.get(source);
    return !audience || audience.has(peerId);
  }

  async function attachLocalTracks(peer) {
    const existing = new Map();
    for (const sender of peer.pc.getSenders()) {
      const source = peer.senderSources.get(sender);
      const kind = peer.senderKinds.get(sender) || sender.track?.kind;
      if (source && kind) existing.set(`${source}:${kind}`, sender);
    }

    for (const [source, stream] of localStreams) {
      for (const track of stream.getTracks()) {
        const key = `${source}:${track.kind}`;
        if (existing.has(key)) continue;
        try {
          const sender = peer.pc.addTrack(track, stream);
          peer.senderSources.set(sender, source);
          peer.senderKinds.set(sender, track.kind);
          if (!sourceAllowed(peer.id, source)) await sender.replaceTrack(null);
        } catch (error) {
          report(error, 'add-local-track');
        }
      }
    }
  }

  async function negotiate(peer, { iceRestart = false } = {}) {
    if (closed || peer.closed || peer.makingOffer) return;
    try {
      peer.makingOffer = true;
      await attachLocalTracks(peer);
      const offer = await peer.pc.createOffer({ iceRestart });
      if (peer.pc.signalingState !== 'stable') return;
      await peer.pc.setLocalDescription(offer);
      await send({
        type: 'webrtc-offer',
        to: peer.id,
        sdp: plainDescription(peer.pc.localDescription),
        media: peerMedia(peer),
        iceRestart: !!iceRestart
      });
    } catch (error) {
      report(error, 'create-offer');
    } finally {
      peer.makingOffer = false;
    }
  }

  function remoteKey(peerId, source) {
    return `${peerId}:${source}`;
  }

  function attachRemoteTrack(peer, event) {
    const track = event.track;
    if (!track) return;
    const mid = event.transceiver?.mid || '';
    const source = peer.remoteMedia.get(mid) || 'camera';
    const key = remoteKey(peer.id, source);
    let stream = remoteStreams.get(key);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(key, stream);
    }
    if (!stream.getTracks().some((item) => item.id === track.id)) stream.addTrack(track);
    const emit = () => onRemoteStream?.({ peerId: peer.id, source, stream, track });
    track.addEventListener?.('ended', () => {
      try { stream.removeTrack(track); } catch {}
      if (!stream.getTracks().length) remoteStreams.delete(key);
      emit();
    }, { once: true });
    emit();
  }

  async function createPeer(peerId) {
    const id = String(peerId || '').trim();
    if (!id || id === localId || closed) return null;
    if (peers.has(id)) return peers.get(id);

    const pc = peerConnectionFactory({
      iceServers: await iceServers(),
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle'
    });
    const peer = {
      id,
      pc,
      polite: localId.localeCompare(id) > 0,
      makingOffer: false,
      ignoreOffer: false,
      restartAttempts: 0,
      restartTimer: 0,
      pendingCandidates: [],
      remoteMedia: new Map(),
      senderSources: new Map(),
      senderKinds: new Map(),
      closed: false
    };
    peers.set(id, peer);
    await attachLocalTracks(peer);

    pc.onicecandidate = (event) => {
      if (!event.candidate || peer.closed) return;
      send({ type: 'webrtc-ice', to: id, candidate: plainCandidate(event.candidate) })
        .catch((error) => report(error, 'send-ice'));
    };
    pc.ontrack = (event) => attachRemoteTrack(peer, event);
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      onPeerState?.({ peerId: id, state });
      if (state === 'connected') peer.restartAttempts = 0;
      if (state === 'failed' && peer.restartAttempts < 2) {
        peer.restartAttempts += 1;
        clearTimeout(peer.restartTimer);
        peer.restartTimer = setTimeout(() => negotiate(peer, { iceRestart: true }), 900 * peer.restartAttempts);
      }
      if (state === 'closed') closePeer(id, { notify: false });
    };
    pc.onnegotiationneeded = () => negotiate(peer);
    return peer;
  }

  async function connectPeer(peerId, { initiate } = {}) {
    const peer = await createPeer(peerId);
    if (!peer) return null;
    const shouldInitiate = initiate ?? (localId.localeCompare(peer.id) < 0);
    if (shouldInitiate) await negotiate(peer);
    return peer.pc;
  }

  async function setLocalStream(source, stream) {
    const safeSource = String(source || '').trim();
    if (!safeSource || !stream?.getTracks) throw new Error('MEDIA_STREAM_REQUIRED');
    if (localStreams.get(safeSource) === stream) return stream;
    await removeLocalStream(safeSource, { stop: false, renegotiate: false });
    localStreams.set(safeSource, stream);
    await Promise.all([...peers.values()].map((peer) => attachLocalTracks(peer)));
    await Promise.all([...peers.values()].map((peer) => negotiate(peer)));
    return stream;
  }

  async function removeLocalStream(source, { stop = false, renegotiate = true } = {}) {
    const safeSource = String(source || '').trim();
    const stream = localStreams.get(safeSource);
    localStreams.delete(safeSource);
    for (const peer of peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (peer.senderSources.get(sender) !== safeSource) continue;
        try { peer.pc.removeTrack(sender); } catch {}
        peer.senderSources.delete(sender);
        peer.senderKinds.delete(sender);
      }
    }
    if (stop && stream) stream.getTracks().forEach((track) => track.stop());
    if (renegotiate) await Promise.all([...peers.values()].map((peer) => negotiate(peer)));
  }

  async function announce(source = 'camera') {
    await send({ type: 'media-ready', source: String(source || 'camera') });
  }

  async function setSourceAudience(source, peerIds = null) {
    const safeSource = String(source || '').trim();
    if (!safeSource) throw new Error('MEDIA_SOURCE_REQUIRED');
    const audience = peerIds === null
      ? null
      : new Set((peerIds || []).map(String).filter((id) => id && id !== localId));
    const audienceKey = audience ? [...audience].sort().join('|') : '*';
    if (sourceAudienceKeys.get(safeSource) === audienceKey) return;
    sourceAudienceKeys.set(safeSource, audienceKey);
    if (audience) sourceAudiences.set(safeSource, audience);
    else sourceAudiences.delete(safeSource);

    const stream = localStreams.get(safeSource);
    await Promise.all([...peers.values()].flatMap((peer) => {
      const enabled = sourceAllowed(peer.id, safeSource);
      return [...peer.pc.getSenders()].flatMap((sender) => {
        if (peer.senderSources.get(sender) !== safeSource) return [];
        const kind = peer.senderKinds.get(sender) || sender.track?.kind;
        const track = enabled ? stream?.getTracks().find((item) => item.kind === kind) || null : null;
        return [sender.replaceTrack(track).catch((error) => report(error, 'set-source-audience'))];
      });
    }));
  }

  async function syncPeers(peerIds = []) {
    const wanted = new Set(peerIds.map(String).filter((id) => id && id !== localId));
    for (const id of [...peers.keys()]) {
      if (!wanted.has(id)) closePeer(id, { notify: false });
    }
    await Promise.all([...wanted].map((id) => (
      peers.has(id) ? Promise.resolve(peers.get(id).pc) : connectPeer(id, { initiate: true })
    )));
  }

  async function flushCandidates(peer) {
    if (!peer.pc.remoteDescription) return;
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try { await peer.pc.addIceCandidate(candidate); } catch (error) { report(error, 'add-ice'); }
    }
  }

  async function handleSignal(message) {
    if (closed || !isMediaSignal(message)) return false;
    const from = String(message.from || '').trim();
    if (!from || from === localId) return false;
    if (message.to && String(message.to) !== localId) return false;

    if (message.type === 'webrtc-bye') {
      closePeer(from, { notify: false });
      return true;
    }
    if (message.type === 'media-ready') {
      await connectPeer(from, { initiate: false });
      return true;
    }

    const peer = await createPeer(from);
    if (!peer) return false;

    if (message.type === 'webrtc-ice') {
      if (!message.candidate) return true;
      if (!peer.pc.remoteDescription) peer.pendingCandidates.push(message.candidate);
      else {
        try { await peer.pc.addIceCandidate(message.candidate); } catch (error) { report(error, 'add-ice'); }
      }
      return true;
    }

    if (!message.sdp) return true;
    const isOffer = message.type === 'webrtc-offer';
    const collision = isOffer && (peer.makingOffer || peer.pc.signalingState !== 'stable');
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return true;

    if (Array.isArray(message.media)) {
      peer.remoteMedia = new Map(message.media
        .filter((entry) => entry?.mid && entry?.source)
        .map((entry) => [String(entry.mid), String(entry.source)]));
    }

    try {
      if (collision && peer.pc.signalingState !== 'stable') {
        await peer.pc.setLocalDescription({ type: 'rollback' });
      }
      await peer.pc.setRemoteDescription(message.sdp);
      await flushCandidates(peer);
      if (isOffer) {
        await attachLocalTracks(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await send({
          type: 'webrtc-answer',
          to: from,
          sdp: plainDescription(peer.pc.localDescription),
          media: peerMedia(peer)
        });
      }
    } catch (error) {
      report(error, 'apply-description');
    }
    return true;
  }

  function closePeer(peerId, { notify = true } = {}) {
    const id = String(peerId || '');
    const peer = peers.get(id);
    if (!peer) return;
    peer.closed = true;
    clearTimeout(peer.restartTimer);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.onnegotiationneeded = null;
    try { peer.pc.close(); } catch {}
    peers.delete(id);
    for (const key of [...remoteStreams.keys()]) {
      if (key.startsWith(`${id}:`)) remoteStreams.delete(key);
    }
    if (notify && !closed) send({ type: 'webrtc-bye', to: id }).catch(() => {});
  }

  function closePeers() {
    for (const id of [...peers.keys()]) closePeer(id);
  }

  function close({ stopLocal = false } = {}) {
    if (closed) return;
    closePeers();
    closed = true;
    if (stopLocal) {
      for (const stream of localStreams.values()) stream.getTracks().forEach((track) => track.stop());
    }
    localStreams.clear();
    remoteStreams.clear();
    sourceAudiences.clear();
    sourceAudienceKeys.clear();
  }

  return {
    announce,
    connectPeer,
    syncPeers,
    setLocalStream,
    setSourceAudience,
    removeLocalStream,
    handleSignal,
    closePeer,
    closePeers,
    close,
    get peerCount() { return peers.size; }
  };
}
