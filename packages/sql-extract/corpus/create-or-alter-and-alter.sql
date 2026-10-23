CREATE TABLE dbo.Holds (
    Id INT NOT NULL,
    LoanId INT NOT NULL
);
GO

ALTER TABLE dbo.Holds ADD
    ExpiresAt DATETIME2 NULL,
    CONSTRAINT PK_Holds PRIMARY KEY (Id);
GO

CREATE OR ALTER PROCEDURE dbo.usp_ExpireHolds
AS
DELETE FROM dbo.Holds WHERE ExpiresAt < SYSUTCDATETIME();
GO

ALTER VIEW dbo.OpenHolds
AS
SELECT h.Id
FROM dbo.Holds h
JOIN dbo.Loans l ON l.Id = h.LoanId;
GO

ALTER PROC dbo.usp_TouchHold
    @id INT
AS
UPDATE h
SET h.ExpiresAt = SYSUTCDATETIME()
FROM dbo.Holds AS h
WHERE h.Id = @id;
GO
