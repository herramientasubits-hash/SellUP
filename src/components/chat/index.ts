// Chat de IA — piezas de Thema (`src/components/chat`) portadas a SellUp.
export type {
  ChatCard,
  ChatCardRow,
  ChatConnector,
  ChatLink,
  ChatMessage,
  ChatMessageStatus,
  ChatNews,
  ChatQuestion,
  ChatQuestionOption,
  ChatQuestionOptionDetail,
  ChatRole,
  ChatSource,
  Conversation,
} from "./types";
export { ChatComposer, type ChatComposerProps } from "./chat-composer";
export { ChatAttachMenu, type ChatAttachMenuProps } from "./chat-attach-menu";
export { ChatThread, type ChatThreadActions, type ChatThreadProps } from "./chat-thread";
export { ChatUserMessage, type ChatUserMessageProps } from "./chat-user-message";
export { ChatAgentMessage, type ChatAgentMessageProps } from "./chat-agent-message";
export { ChatThinking, type ChatThinkingProps } from "./chat-thinking";
export { ChatQuestionCard, type ChatQuestionCardProps } from "./chat-question-card";
export { ChatCardView, type ChatCardViewProps } from "./chat-card-view";
export { ChatFeedbackForm, type ChatFeedbackFormProps, type ChatFeedbackPayload } from "./chat-feedback-form";
export { ChatMarkdown, type ChatMarkdownProps } from "./chat-markdown";
export { ChatMark, type ChatMarkProps } from "./chat-mark";
export { ChatGreeting, type ChatGreetingProps } from "./chat-greeting";
export { greetingKey } from "./greeting";
export {
  ChatHistoryList,
  ChatStatusDot,
  groupConversations,
  type ChatHistoryListProps,
  type ConversationGroupKey,
} from "./chat-history-list";
export { ChatHistoryPanel, type ChatHistoryPanelProps } from "./chat-history-panel";
export { ChatPanel, type ChatPanelProps } from "./chat-panel";
export { ChatScreen, type ChatScreenProps } from "./chat-screen";
export { useStreamedText } from "./use-streamed-text";
