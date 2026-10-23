CREATE TABLE [dbo].[Loans] (
    [Id] INT NOT NULL PRIMARY KEY,
    [MemberId] INT NOT NULL,
    [ClosedAt] DATETIME2 NULL,
    CONSTRAINT [FK_Loans_Members] FOREIGN KEY ([MemberId]) REFERENCES [dbo].[Members] ([Id])
);
GO

CREATE VIEW dbo.ActiveLoans
WITH SCHEMABINDING
AS
SELECT l.Id, l.MemberId
FROM dbo.Loans AS l
WHERE l.ClosedAt IS NULL;
GO

CREATE PROCEDURE [dbo].[usp_CloseLoan]
    @id INT
AS
BEGIN
-- GO
    UPDATE dbo.Loans SET ClosedAt = SYSUTCDATETIME() WHERE Id = @id;
    INSERT INTO dbo.LoanEvents (LoanId, Kind) VALUES (@id, 'GO');
    EXEC dbo.usp_NotifyMember @id;
END
GO

CREATE FUNCTION dbo.fn_OpenLoanCount (@memberId INT)
RETURNS INT
AS
BEGIN
    RETURN (SELECT COUNT(*) FROM dbo.ActiveLoans WHERE MemberId = @memberId)
END
GO
