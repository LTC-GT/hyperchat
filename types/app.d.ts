// ─── Internal Quibble type definitions ───

/** Identity object returned by loadIdentity and used throughout the app. */
interface Identity {
  publicKey: Buffer
  secretKey: Buffer
  seedPhrase?: string
  name: string
  dir?: string
  /** Set at runtime by the server, not produced by loadIdentity. */
  avatar?: string | null
  /** Set at runtime by the server, not produced by loadIdentity. */
  status?: string
}

// ─── Message types ───

interface BaseMessage {
  type: string
  id: string
  sender: string
  senderName: string
  senderAvatar: string | null
  senderStatus: string
  timestamp: number
}

interface TextMessage extends BaseMessage {
  type: 'text'
  text: string
}

interface SystemMessage extends BaseMessage {
  type: 'system'
  action: string
  data: Record<string, unknown>
}

interface FileMessage extends BaseMessage {
  type: 'file'
  filename: string
  size: number
  mimeType: string
  coreKey: string
  channelId: string | null
  threadRootId?: string
  dmKey?: string
  dmParticipants?: string[]
}

interface ReactionMessage extends BaseMessage {
  type: 'reaction'
  targetId: string
  emoji: string
}

interface VoiceMessage extends BaseMessage {
  type: 'voice'
  action: string
  sessionId: string
}

interface VideoMessage extends BaseMessage {
  type: 'video'
  action: string
  sessionId: string
}

type RoomMessage = TextMessage | SystemMessage | FileMessage | ReactionMessage | VoiceMessage | VideoMessage

/** Message as returned from Room.history() / Room.historyPage() (with _seq). */
type RoomMessageWithSeq = RoomMessage & { _seq: number }

// ─── Options bags ───

interface RoomConstructorOpts {
  key?: Buffer | null
  encryptionKey?: Buffer | null
  identity?: Identity
  namespace?: string
}

interface QuibbleOpts {
  storage: string
  identity: Identity
  swarmOpts?: Record<string, unknown>
}

interface SendFileOpts {
  channelId?: string
  threadRootId?: string
  dmKey?: string
  dmParticipants?: string[]
}

// ─── ICE / RTC ───

interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

// ─── Client-side UI types ───

interface ClientProfile {
  fullName: string
  username: string
  avatar: string | null
  setupDone: boolean
}

interface ClientSettings {
  cameraId: string
  micId: string
  cameraEnabled: boolean
  micEnabled: boolean
  presenceStatus: string
  noiseCancellation: boolean
  enableHD: boolean
  recordSelfInCall: boolean
  callBitrateMode: string
  notificationTone: string
  ringtone: string
  stunPreset: string
  customStunUrl: string
}

interface CallRecordingState {
  active: boolean
  recorder: MediaRecorder | null
  mixedStream: MediaStream | null
  chunks: Blob[]
  mimeType: string
  canvas: HTMLCanvasElement | null
  canvasStream: MediaStream | null
  animationFrame: number
  audioContext: AudioContext | null
  audioDestination: MediaStreamAudioDestinationNode | null
  audioSources: Map<string, MediaStreamAudioSourceNode>
  audioSyncTimer: ReturnType<typeof setInterval> | null
  includeSelf: boolean
  startedAt: number
}

interface BootState {
  connected: boolean
  identityReady: boolean
  roomDiscoveryReady: boolean
  pendingRoomHistory: Set<string>
  loadedRoomHistory: Set<string>
  sessionToken: number
  profilePromptShown: boolean
}

interface ActiveCall {
  id: string
  mode: string
  roomKey: string
  channelId: string
  dmKey?: string | null
  scope?: string
}

interface ClientRoomMeta {
  link: string
  name: string
  writable: boolean
  icon?: string
  iconEmoji?: string | null
  iconImage?: string | null
  imageData?: string | null
  mimeType?: string | null
  [key: string]: string | boolean | null | undefined
}

interface ChannelEntry {
  id: string
  name: string
  modOnly?: boolean
}

interface UsernameConflict {
  base: string
  suggestions: string[]
  taken: string[]
}

interface ClientMessage {
  type: string
  id: string
  sender: string
  senderName: string
  senderAvatar?: string | null
  senderStatus?: string
  timestamp: number
  text?: string
  action?: string
  data?: Record<string, unknown>
  filename?: string
  size?: number
  mimeType?: string
  coreKey?: string
  channelId?: string | null
  threadRootId?: string
  dmKey?: string
  dmParticipants?: string[]
  targetId?: string
  emoji?: string
  sessionId?: string
  _seq?: number
  _edited?: boolean
  _deleted?: boolean
  _editedText?: string
  [key: string]: string | number | boolean | string[] | Record<string, unknown> | null | undefined
}

interface RoomProfileDraft {
  name?: string
  emoji?: string
  imageData?: string | null
  mimeType?: string | null
}

interface ClientState {
  ws: WebSocket | null
  identity: { publicKey: string } | null
  profile: ClientProfile
  rooms: Map<string, ClientRoomMeta>
  activeRoom: string | null
  peers: Set<string>
  swarmConnections: number
  swarmRooms: number
  swarmWriters: Record<string, number>
  membersVisible: boolean
  messagesByRoom: Map<string, ClientMessage[]>
  seenIds: Set<string>
  seenSeqByRoom: Map<string, Set<number>>
  historyCursorByRoom: Map<string, number | null>
  historyLoadingByRoom: Map<string, boolean>
  historyTimeoutByRoom: Map<string, ReturnType<typeof setTimeout>>
  roomEmojis: Map<string, Map<string, string>>
  roomAdmins: Map<string, Set<string>>
  roomOwnerByRoom: Map<string, string | null>
  roomBansByRoom: Map<string, Map<string, { name: string }>>
  channelKicksByRoom: Map<string, Map<string, { channelId: string; name?: string }>>
  channelsByRoom: Map<string, { text: ChannelEntry[]; voice: ChannelEntry[] }>
  activeTextChannelByRoom: Map<string, string>
  activeVoiceChannelByRoom: Map<string, string>
  channelSearchQuery: string
  activeSearchChannelId: string | null
  searchResultsActive: boolean
  activeThreadRootId: string | null
  pinnedByRoomChannel: Map<string, Map<string, string>>
  messageReactionsByRoom: Map<string, Map<string, Map<string, Set<string>>>>
  friends: Map<string, { name: string }>
  friendRequests: Map<string, { name: string; roomKey: string; outgoing?: boolean }>
  activeDmKey: string | null
  linkPreviewCache: Map<string, Record<string, unknown>>
  activeCall: ActiveCall | null
  localCallStream: MediaStream | null
  rtcIceServers: IceServer[]
  peerConnections: Map<string, RTCPeerConnection>
  remoteStreams: Map<string, MediaStream>
  callTheater: boolean
  callScreenStream: MediaStream | null
  callRecording: CallRecordingState
  sessionCallEventsByRoom: Map<string, { id: string; msg: ClientMessage }[]>
  settings: ClientSettings
  p2pNetworkTest: { status: string; summary: string; checkedAt: number; runToken: number }
  audioPreviewTimer: ReturnType<typeof setTimeout> | null
  ringingTimer: ReturnType<typeof setTimeout> | null
  usernameConflictByRoom: Map<string, UsernameConflict>
  pendingCreatedRoomProfile: RoomProfileDraft | null
  createRoomDraft: { name: string; emoji: string; imageData: string | null; mimeType: string | null }
  pendingSeedPhrase: string
  boot: BootState
  lastPresenceActivityAt?: number
  _callEventTimers?: Map<string, ReturnType<typeof setTimeout>>
  [key: string]: unknown
}

interface DialogOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  placeholder?: string
  defaultValue?: string
}

interface CallScope {
  roomKey: string
  scope: string
  channelId: string
  dmKey?: string
}

interface TonePresetOptions {
  volume?: number
  duration?: number
  loop?: boolean
  repeats?: number
  repeatGap?: number
}

// Augment RTCPeerConnection for Perfect Negotiation custom properties
interface RTCPeerConnection {
  _makingOffer?: boolean
  _ignoreOffer?: boolean
}
