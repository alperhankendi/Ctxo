CREATE TABLE dbo.LoanBatches (Id INT NOT NULL)
GO
CREATE PROCEDURE dbo.usp_Setup
AS
BEGIN
    CREATE TABLE dbo.LoanStaging (Id INT NOT NULL);
    ALTER TABLE dbo.LoanBatches ADD Note NVARCHAR(100) NULL;
    INSERT INTO dbo.LoanStaging (Id) SELECT Id FROM dbo.Loans;
    UPDATE dbo.Members SET Blocked = 0 WHERE Blocked = 1;
END
