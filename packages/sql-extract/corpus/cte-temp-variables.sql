WITH Active AS (
    SELECT * FROM dbo.Loans WHERE ClosedAt IS NULL
), Late AS (
    SELECT * FROM Active WHERE DueAt < GETDATE()
)
SELECT *
FROM Late l
JOIN #Seen s ON s.Id = l.Id
JOIN @Ids i ON i.Id = l.Id
