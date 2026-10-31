---
"@ctxo/domain": patch
---

The domain pass classifies the test cases of a file in O(n log n) instead of O(n^2), with the same output, so a generated test file with thousands of cases no longer slows it down. `ctxo domain discover` no longer lets a test file named after a non-test class (`LoanContractTests.cs` next to `LoanContract`) keep its whole file-name family (`**/*ContractTests.cs`) out of the proposal: the entity file is left out of the family's evidence and the glob is proposed on the other files, while a family made only of entity files stays evidence only. The printout lists the files left out and `--json` adds `entityFiles` to `testKindMarkers.<kind>.fileNames`.
