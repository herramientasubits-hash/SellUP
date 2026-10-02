import type { ChatMessageKey } from "./messages";

type GreetingKey = Extract<ChatMessageKey, `chat.greeting.${string}`>;

/** El saludo según la hora: buenos días hasta las 12, buenas tardes hasta las 19. */
export function greetingKey(hour: number = new Date().getHours()): GreetingKey {
  if (hour < 12) return "chat.greeting.morning";
  if (hour < 19) return "chat.greeting.afternoon";
  return "chat.greeting.evening";
}
