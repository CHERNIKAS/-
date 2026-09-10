-- Общая книга заводилась до появления вида: у неё стоял флаг is_shared, а вид
-- по умолчанию оказался «личная». Приводим в соответствие один раз.
UPDATE "ledgers" SET "kind" = 'shared' WHERE "is_shared" = true AND "kind" = 'personal';
