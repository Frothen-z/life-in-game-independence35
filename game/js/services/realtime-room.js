const ROOM_ID_RE = /^[a-z0-9][a-z0-9:_-]{1,95}$/i;

function safeRoomId(value) {
  const roomId = String(value || '').trim();
  if (!ROOM_ID_RE.test(roomId)) throw new Error('INVALID_ROOM_ID');
  return roomId;
}

function flattenPresence(state) {
  return Object.entries(state || {}).flatMap(([key, rows]) =>
    (Array.isArray(rows) ? rows : []).map((row) => ({ key, ...row }))
  );
}

export function createRealtimeRoom({
  client,
  topic,
  playerId,
  displayName,
  presence = {},
  onMessage,
  onPresence,
  onStatus
}) {
  if (!client?.channel || !client?.removeChannel) throw new Error('REALTIME_CLIENT_REQUIRED');
  const safeTopic = safeRoomId(topic);
  const safePlayerId = String(playerId || '').trim();
  if (!safePlayerId) throw new Error('PLAYER_ID_REQUIRED');

  let channel = null;
  let connectPromise = null;
  let closed = false;
  let meta = {
    id: safePlayerId,
    name: String(displayName || 'Игрок').slice(0, 80),
    online_at: new Date().toISOString(),
    ...presence
  };

  function members() {
    return channel ? flattenPresence(channel.presenceState()) : [];
  }

  function emitPresence() {
    onPresence?.(members());
  }

  async function connect() {
    if (closed) throw new Error('ROOM_CLOSED');
    if (channel) return channel;
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('REALTIME_TIMEOUT'));
      }, 12000);

      channel = client.channel(safeTopic, {
        config: {
          private: true,
          broadcast: { self: false, ack: true },
          presence: { key: safePlayerId }
        }
      });

      channel
        .on('broadcast', { event: 'message' }, ({ payload: message }) => {
          if (!message || message.from === safePlayerId) return;
          if (message.to && message.to !== safePlayerId) return;
          onMessage?.(message);
        })
        .on('presence', { event: 'sync' }, emitPresence)
        .on('presence', { event: 'join' }, emitPresence)
        .on('presence', { event: 'leave' }, emitPresence)
        .subscribe(async (status) => {
          onStatus?.(status);
          if (status === 'SUBSCRIBED') {
            try {
              await channel.track(meta);
              emitPresence();
              if (!settled) {
                settled = true;
                window.clearTimeout(timeout);
                resolve(channel);
              }
            } catch (error) {
              if (!settled) {
                settled = true;
                window.clearTimeout(timeout);
                reject(error);
              }
            }
          }
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(`REALTIME_${status}`));
          }
        });
    }).catch(async (error) => {
      if (channel) {
        try { await client.removeChannel(channel); } catch {}
      }
      channel = null;
      connectPromise = null;
      throw error;
    });

    return connectPromise;
  }

  async function send(message) {
    if (!message || typeof message !== 'object') return false;
    const activeChannel = await connect();
    const response = await activeChannel.send({
      type: 'broadcast',
      event: 'message',
      payload: {
        ...message,
        from: safePlayerId,
        name: meta.name,
        t: Date.now()
      }
    });
    return response === 'ok';
  }

  async function track(nextPresence = {}) {
    meta = { ...meta, ...nextPresence, id: safePlayerId };
    const activeChannel = await connect();
    await activeChannel.track(meta);
    emitPresence();
  }

  async function close() {
    if (closed) return;
    closed = true;
    const activeChannel = channel;
    channel = null;
    connectPromise = null;
    if (!activeChannel) return;
    try { await activeChannel.untrack(); } catch {}
    try { await client.removeChannel(activeChannel); } catch {}
  }

  return {
    topic: safeTopic,
    connect,
    send,
    track,
    members,
    close,
    get connected() { return !!channel && !closed; }
  };
}

export function isRealtimeAuthError(error) {
  const text = String(error?.message || error || '');
  return text.includes('REALTIME_CLIENT_REQUIRED') || text.includes('AUTH_REQUIRED');
}
