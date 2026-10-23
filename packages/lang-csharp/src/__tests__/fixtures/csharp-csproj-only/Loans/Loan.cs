namespace CsprojOnly.Loans;

public class Loan
{
    public int RenewalsLeft(int renewalsUsed)
    {
        return 2 - renewalsUsed;
    }
}
