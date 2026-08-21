function cleanSearch(value) {
  return String(value || '').trim().slice(0, 40);
}

function mapProfiles(rows) {
  return new Map((rows || []).map((profile) => [profile.id, profile]));
}

export function createSocialService(client, userId) {
  if (!client || !userId) throw new Error('SOCIAL_AUTH_REQUIRED');

  async function searchProfiles(query) {
    const value = cleanSearch(query);
    if (value.length < 2) return [];
    const { data, error } = await client.rpc('search_profiles', { search_text: value });
    if (error) throw error;
    return data || [];
  }

  async function sendFriendRequest(targetUser) {
    const { data, error } = await client.rpc('send_friend_request', { target_user: targetUser });
    if (error) throw error;
    return data;
  }

  async function getIncomingRequests() {
    const { data: requests, error } = await client
      .from('friend_requests')
      .select('id,sender_id,created_at')
      .eq('receiver_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const ids = [...new Set((requests || []).map((item) => item.sender_id))];
    if (!ids.length) return [];
    const { data: profiles, error: profileError } = await client
      .from('profiles')
      .select('id,username,name,status,photo')
      .in('id', ids);
    if (profileError) throw profileError;
    const byId = mapProfiles(profiles);
    return requests.map((request) => ({ ...request, profile: byId.get(request.sender_id) }));
  }

  async function respondToRequest(requestId, accept) {
    const { error } = await client.rpc('respond_friend_request', {
      target_request: requestId,
      accept_request: !!accept
    });
    if (error) throw error;
  }

  async function listFriends() {
    const { data, error } = await client.rpc('list_friends');
    if (error) throw error;
    return data || [];
  }

  async function blockUser(targetUser) {
    const { error } = await client.from('blocks').insert({ blocker_id: userId, blocked_id: targetUser });
    if (error && error.code !== '23505') throw error;
  }

  async function unblockUser(targetUser) {
    const { error } = await client.from('blocks').delete().eq('blocker_id', userId).eq('blocked_id', targetUser);
    if (error) throw error;
  }

  async function getOrCreateDm(targetUser) {
    const { data, error } = await client.rpc('get_or_create_dm', { target_user: targetUser });
    if (error) throw error;
    return data;
  }

  async function listConversations() {
    const { data: memberships, error } = await client
      .from('conversation_members')
      .select('conversation_id,last_read_at,conversations(id,type,title,updated_at)')
      .eq('user_id', userId);
    if (error) throw error;
    const conversationIds = (memberships || []).map((item) => item.conversation_id);
    if (!conversationIds.length) return [];
    const { data: members, error: memberError } = await client
      .from('conversation_members')
      .select('conversation_id,user_id')
      .in('conversation_id', conversationIds);
    if (memberError) throw memberError;
    const otherIds = [...new Set((members || []).filter((item) => item.user_id !== userId).map((item) => item.user_id))];
    let profiles = [];
    if (otherIds.length) {
      const response = await client.from('profiles').select('id,username,name,photo,status').in('id', otherIds);
      if (response.error) throw response.error;
      profiles = response.data || [];
    }
    const profileById = mapProfiles(profiles);
    const othersByConversation = new Map();
    for (const member of members || []) {
      if (member.user_id === userId) continue;
      const list = othersByConversation.get(member.conversation_id) || [];
      const profile = profileById.get(member.user_id);
      if (profile) list.push(profile);
      othersByConversation.set(member.conversation_id, list);
    }
    return memberships
      .map((item) => ({
        id: item.conversation_id,
        ...item.conversations,
        lastReadAt: item.last_read_at,
        participants: othersByConversation.get(item.conversation_id) || []
      }))
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }

  async function listMessages(conversationId, before) {
    let query = client
      .from('messages')
      .select('id,conversation_id,sender_id,body,reply_to,edited_at,deleted_at,created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).reverse();
  }

  async function sendMessage(conversationId, body, replyTo = null) {
    const { data, error } = await client.rpc('send_message', {
      target_conversation: conversationId,
      message_body: String(body || '').trim(),
      target_reply: replyTo
    });
    if (error) throw error;
    return data;
  }

  async function markConversationRead(conversationId) {
    const { error } = await client
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async function listNotifications() {
    const { data, error } = await client
      .from('notifications')
      .select('id,actor_id,kind,data,read_at,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const actorIds = [...new Set((data || []).map((item) => item.actor_id).filter(Boolean))];
    let actors = [];
    if (actorIds.length) {
      const response = await client.from('profiles').select('id,username,name,photo').in('id', actorIds);
      if (response.error) throw response.error;
      actors = response.data || [];
    }
    const byId = mapProfiles(actors);
    return (data || []).map((item) => ({ ...item, actor: byId.get(item.actor_id) }));
  }

  async function markNotificationsRead() {
    const { error } = await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
  }

  function subscribe(onChange) {
    return client
      .channel(`social:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onChange)
      .subscribe();
  }

  return {
    searchProfiles,
    sendFriendRequest,
    getIncomingRequests,
    respondToRequest,
    listFriends,
    blockUser,
    unblockUser,
    getOrCreateDm,
    listConversations,
    listMessages,
    sendMessage,
    markConversationRead,
    listNotifications,
    markNotificationsRead,
    subscribe
  };
}
