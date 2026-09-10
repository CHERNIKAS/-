/**
 * Повтор запроса к модели.
 *
 * Gemini регулярно отвечает 503 «перегружен» и 429 «слишком часто» — это не
 * поломка, а обычное состояние бесплатного доступа. Одна такая секунда роняла
 * весь импорт выписки на тысячу строк, и человек шёл искать несуществующую
 * ошибку в файле.
 *
 * Пауза растёт между попытками: если сервис занят, ломиться в него сразу же —
 * значит получить тот же ответ.
 */

/** Коды, при которых повтор имеет смысл: перегрузка и предел частоты. */
const RETRIABLE = new Set([429, 500, 502, 503, 504]);

export type Fetcher = typeof fetch;

export type RetryOptions = {
  /** Сколько раз пробовать всего, включая первую. */
  attempts?: number;
  /** Пауза перед вторым заходом; дальше удваивается. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export function isRetriable(status: number): boolean {
  return RETRIABLE.has(status);
}

/**
 * Запрос с повтором на временных отказах.
 *
 * Обрыв связи лечится тем же способом, что и 503, поэтому исключение из fetch
 * тоже считается поводом попробовать ещё раз — но только пока попытки есть.
 */
export async function fetchWithRetry(
  doFetch: Fetcher,
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let delay = options.delayMs ?? 1200;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await doFetch(url, init);
      if (response.ok || !isRetriable(response.status) || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }

    await sleep(delay);
    delay *= 2;
  }

  // Сюда попадаем только если все попытки закончились исключением.
  throw lastError ?? new Error("сервис недоступен");
}
