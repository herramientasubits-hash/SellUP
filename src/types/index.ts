// Tipos globales de TypeScript para SellUp
// Se irán completando a medida que se defina el modelo de datos

export type ID = string;

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}
