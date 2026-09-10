import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const currencyEnum = pgEnum("currency", ["USD", "EUR", "UAH", "TRY"]);
export const sourceEnum = pgEnum("source", ["bot", "app"]);
export const paymentEnum = pgEnum("payment", ["card", "cash", "transfer"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);

/**
 * Назначение книги.
 *
 * Личная и общая отличаются только числом участников, а бизнес — вопросом, на
 * который отвечает главный экран: там важно «сколько заработал», а не «сколько
 * осталось». Поэтому вид книги, а не флаг «общая».
 */
export const ledgerKindEnum = pgEnum("ledger_kind", ["personal", "shared", "business"]);
/**
 * Вид операции.
 *
 * Переводы между своими счетами не хранятся вовсе: вывел с кошелька на карту —
 * денег не прибавилось и не убавилось, а в отчёте появился бы фантом.
 */
export const kindEnum = pgEnum("expense_kind", ["expense", "income", "transfer"]);

export const botMessageKindEnum = pgEnum("bot_message_kind", ["card", "panel", "summary"]);

export const users = pgTable(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    tgId: numeric("tg_id", { precision: 20, scale: 0 }).notNull(),
    username: varchar({ length: 64 }),
    firstName: varchar("first_name", { length: 128 }),

    currency: currencyEnum().notNull().default("USD"),
    timezone: varchar({ length: 64 }).notNull().default("Europe/Istanbul"),

    reminderEnabled: boolean("reminder_enabled").notNull().default(true),
    reminderHour: smallint("reminder_hour").notNull().default(21),
    monthlyDigest: boolean("monthly_digest").notNull().default(false),
    /** Уборка карточек в чате раз в сутки. Выключена по умолчанию. */
    dailyCleanup: boolean("daily_cleanup").notNull().default(false),
    partnerNotifications: boolean("partner_notifications").notNull().default(true),

    monthlyBudget: numeric("monthly_budget", { precision: 14, scale: 2 }),

    /**
     * Свои источники дохода, JSON-массивом.
     *
     * Списком, а не таблицей: их единицы, они не участвуют в отчётах и нужны
     * только как подсказки при вводе. Пусто — берётся список по умолчанию.
     */
    incomeSources: text("income_sources"),

    /** День последнего вечернего напоминания — чтобы не слать его дважды. */
    lastReminderDay: date("last_reminder_day"),
    /** День последнего предложения по категориям: они приходят раз в неделю. */
    lastSuggestionDay: date("last_suggestion_day"),

    /** День последнего недельного итога — чтобы не прислать его дважды. */
    lastWeeklyDay: date("last_weekly_day"),

    /** Месяц, за который разбор уже присылали. */
    lastDigestMonth: date("last_digest_month"),

    /**
     * Куда пишутся траты сейчас. Пусто — в личную книгу.
     *
     * Переключатель, а не поле у каждой траты: человек обычно ведёт учёт
     * периодами «сейчас общее», а не решает заново на каждой покупке.
     */
    activeLedgerId: integer("active_ledger_id"),
    defaultPayment: paymentEnum("default_payment").notNull().default("card"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_tg_id_key").on(t.tgId)],
);

/**
 * Книга трат. У каждого пользователя есть личная, плюс может быть общая
 * на несколько человек. Категории принадлежат книге, правила — человеку.
 */
export const ledgers = pgTable("ledgers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: varchar({ length: 128 }).notNull(),
  isShared: boolean("is_shared").notNull().default(false),
  kind: ledgerKindEnum().notNull().default("personal"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id),
  inviteToken: varchar("invite_token", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerMembers = pgTable(
  "ledger_members",
  {
    ledgerId: integer("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum().notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ledgerId, t.userId] })],
);

export const categories = pgTable(
  "categories",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    ledgerId: integer("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    slug: varchar({ length: 32 }).notNull(),
    title: varchar({ length: 64 }).notNull(),
    emoji: varchar({ length: 8 }).notNull().default("📦"),
    /** Уходит в промпт модели — одна строка описания даёт больше точности, чем длинный промпт. */
    hint: text(),
    sort: smallint().notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_ledger_slug_key").on(t.ledgerId, t.slug)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    ledgerId: integer("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    categoryId: integer("category_id").references(() => categories.id),

    /** Сумма и валюта — как потратил. Пересчёт только для показа. */
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: currencyEnum().notNull(),
    /** Курс к USD на дату траты. Фиксируется при создании и больше не меняется. */
    rateToUsd: numeric("rate_to_usd", { precision: 18, scale: 8 }).notNull(),

    spentAt: date("spent_at").notNull(),
    merchant: varchar({ length: 128 }),
    note: text(),

    source: sourceEnum().notNull(),
    payment: paymentEnum().notNull().default("card"),

    /**
     * Расход, доход или перевод между своими счетами.
     *
     * Перевод не участвует ни в «Потрачено», ни в доходах: деньги не появились
     * и не исчезли, они переложены из кармана в карман. Хранить его всё равно
     * нужно — иначе не с чем сводить приход на другом счёте.
     */
    kind: kindEnum().notNull().default("expense"),
    /** Откуда доход: зарплата, фриланс, подарок, продажа. Только для доходов. */
    incomeSource: varchar("income_source", { length: 32 }),

    /**
     * Сколько по этой покупке вернули.
     *
     * Возврат гасит покупку, а не становится доходом: иначе месяц показывает и
     * лишнюю трату, и лишний доход, хотя не случилось ни того, ни другого.
     * Суммой, а не флагом, — возвращают и частями.
     */
    refundedAmount: numeric("refunded_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    /** Какой импорт погасил покупку — по нему же откат импорта её и вернёт. */
    refundImportId: integer("refund_import_id"),

    /**
     * Вторая сторона операции: адрес кошелька, отправитель перевода, номер
     * счёта. По ней сводятся пары и группируется список на проверку.
     */
    counterparty: varchar({ length: 128 }),
    /** Встречная операция на другом счёте: та же сумма, ушедшая и пришедшая. */
    pairedWithId: integer("paired_with_id"),
    /**
     * Ждёт решения человека: доход это или свои деньги.
     *
     * Ответ не запоминается за адресом намеренно — с одного и того же адреса
     * может прийти и заработок, и собственные деньги.
     */
    needsKindReview: boolean("needs_kind_review").notNull().default(false),

    /**
     * Движение по балансу, которое породила эта операция.
     *
     * Обнал не тратит деньги, а перекладывает их в наличку: с крипты ушло, в
     * кармане появилось. Ссылка нужна, чтобы правка операции не плодила
     * движения, а переписывала своё.
     */
    balanceEntryId: integer("balance_entry_id"),
    /** Место, куда переехали деньги: показывается в карточке операции. */
    balancePlace: varchar("balance_place", { length: 64 }),
    /**
     * Отпечаток строки возврата.
     *
     * Повторный импорт того же файла не должен гасить покупки во второй раз:
     * траты от задвоения защищает свой отпечаток, возвраты — этот.
     */
    refundFingerprint: varchar("refund_fingerprint", { length: 64 }),

    /** Уверенность модели, 0..1. null — категорию поставило правило пользователя. */
    confidence: numeric({ precision: 3, scale: 2 }),
    /** Модель ещё не ответила: категория временная, воркер вернётся к трате. */
    needsReview: boolean("needs_review").notNull().default(false),

    /** Из какого импорта пришла трата — по нему же импорт откатывается целиком. */
    importId: integer("import_id"),
    /**
     * Отпечаток строки выписки: дата, сумма и описание.
     *
     * Повторный импорт того же файла не задваивает траты, а пересечения с
     * тем, что уже внесено руками, видно до применения.
     */
    fingerprint: varchar({ length: 64 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("expenses_ledger_spent_at_idx").on(t.ledgerId, t.spentAt),
    index("expenses_category_idx").on(t.categoryId),
    index("expenses_needs_review_idx").on(t.needsReview),
    index("expenses_fingerprint_idx").on(t.ledgerId, t.fingerprint),
    index("expenses_kind_idx").on(t.ledgerId, t.kind, t.spentAt),
  ],
);

/**
 * Выученные правила «строка → категория».
 *
 * Правила принадлежат человеку, а не книге: в общем бюджете у каждого свой
 * словарь, а категории общие. Одна правка при вводе создаёт запись здесь, и
 * со следующего раза модель для этой строки не вызывается вообще.
 */
export const rules = pgTable(
  "rules",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Название траты в нижнем регистре, без лишних пробелов. */
    pattern: varchar({ length: 128 }).notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    hits: integer().notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rules_user_pattern_key").on(t.userId, t.pattern)],
);

/**
 * Сырой ввод — всё, что человек написал боту, до всякого разбора и удаления.
 *
 * Пишется раньше, чем сообщение исчезает из чата, поэтому чистка чата ничего
 * не уничтожает. Здесь же ключ идемпотентности: повторная доставка вебхука
 * или ретрай при обрыве не создадут вторую трату.
 */
export const rawInputs = pgTable(
  "raw_inputs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: numeric("chat_id", { precision: 20, scale: 0 }).notNull(),
    tgMessageId: integer("tg_message_id").notNull(),
    text: text().notNull(),
    parsed: text("parsed_json"),
    deletedFromChat: boolean("deleted_from_chat").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("raw_inputs_chat_message_key").on(t.chatId, t.tgMessageId)],
);

/**
 * Сообщения бота, которыми он управляет: карточки трат, закреплённая панель,
 * сводки. Нужны, чтобы редактировать нужное сообщение вместо отправки нового
 * и чтобы уборка знала, что именно удалять.
 */
export const botMessages = pgTable(
  "bot_messages",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: numeric("chat_id", { precision: 20, scale: 0 }).notNull(),
    messageId: integer("message_id").notNull(),
    kind: botMessageKindEnum().notNull(),
    expenseId: integer("expense_id").references(() => expenses.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cleanedAt: timestamp("cleaned_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("bot_messages_chat_message_key").on(t.chatId, t.messageId),
    index("bot_messages_cleanup_idx").on(t.kind, t.createdAt),
  ],
);

/**
 * Курсы к USD по датам. Тянутся раз в сутки и остаются здесь навсегда:
 * история не должна зависеть от того, живы ли внешние сервисы завтра.
 */
export const rates = pgTable(
  "rates",
  {
    day: date().notNull(),
    currency: currencyEnum().notNull(),
    /** Сколько USD стоит одна единица валюты. */
    toUsd: numeric("to_usd", { precision: 18, scale: 8 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.currency] })],
);

/**
 * Регулярные платежи: подписки, аренда, счета.
 *
 * Заводятся один раз и начисляются сами. Смысл именно в этом: такие траты
 * человек помнит хуже всего — они не сопровождаются походом в магазин, и
 * именно они тихо съедают бюджет.
 */
export const recurring = pgTable(
  "recurring",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    ledgerId: integer("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id),

    title: varchar({ length: 128 }).notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: currencyEnum().notNull(),

    /** День месяца, 1–28: 29–31 есть не в каждом месяце. */
    dayOfMonth: smallint("day_of_month").notNull(),
    active: boolean().notNull().default(true),
    /** Первое число месяца, за который платёж уже начислен. */
    chargedMonth: date("charged_month"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recurring_ledger_idx").on(t.ledgerId, t.active)],
);

export const importStatusEnum = pgEnum("import_status", ["preview", "applied", "cancelled"]);

/**
 * Импорт банковской выписки.
 *
 * Разбор и применение разнесены: сначала файл превращается в предпросмотр, и
 * только после подтверждения строки становятся тратами. Иначе кривая карта
 * формата молча засоряет историю сотнями записей.
 */
export const imports = pgTable("imports", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ledgerId: integer("ledger_id")
    .notNull()
    .references(() => ledgers.id, { onDelete: "cascade" }),

  filename: varchar({ length: 255 }).notNull(),
  status: importStatusEnum().notNull().default("preview"),
  /** Разобранные строки до применения: JSON, живёт до подтверждения. */
  payload: text(),
  /** Карта формата, которую определила модель — видно, как файл был понят. */
  mapping: text(),
  rowCount: integer("row_count").notNull().default(0),

  /**
   * Где лежит сам файл выписки.
   *
   * Разобранные строки живут только до подтверждения, а исходник остаётся: без
   * него нельзя ни проверить спорную сумму, ни понять, почему формат разобрался
   * не так. Путь, а не содержимое: базе незачем распухать от PDF-ов.
   */
  storedPath: varchar("stored_path", { length: 512 }),
  fileSize: integer("file_size"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

/**
 * Движения по балансу.
 *
 * Баланс не хранится числом, которое переписывают: хранятся движения, а
 * остаток — их сумма. Так видно, из чего он сложился, и любую ошибку можно
 * поправить встречным движением, ничего не затирая.
 *
 * Это отдельный слой от трат: траты отвечают на вопрос «куда ушло», баланс —
 * «сколько есть». Второе не выводится из первого, пока учёт неполон: наличные
 * тратятся молча, и никакая выписка этого не увидит.
 */
export const balanceEntries = pgTable(
  "balance_entries",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    ledgerId: integer("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Где лежат деньги: карта, крипта, наличка. Свободное слово, не список. */
    place: varchar({ length: 64 }).notNull(),
    /** Со знаком: плюс — прибавилось, минус — убавилось. */
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: currencyEnum().notNull(),
    note: varchar({ length: 128 }),

    happenedAt: date("happened_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("balance_ledger_idx").on(t.ledgerId, t.place)],
);
