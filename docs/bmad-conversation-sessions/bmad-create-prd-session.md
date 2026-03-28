````
Phase 2: Planning (Required)
For BMad Method and Enterprise tracks:

Invoke the PM agent (bmad-agent-pm) in a new chat
Run the bmad-create-prd workflow (bmad-create-prd)
Output: PRD.md

````



❯ /bmad-create-prd                                                                                                                                    
                   
  Read 3 files (ctrl+o to expand)                                                                                                                     
                                                                                                                                                    
⏺ Let me check for existing workflow state and discover input documents.                                                                              
                                                                                                                                                    
  Searched for 5 patterns, read 1 file (ctrl+o to expand)                                                                                             
                                                                                                                                                      
⏺ Create Mode: Creating a new PRD from scratch.                                                                                                       
                                                                                                                                                      
  Hello Alper! I've analyzed the current state of your workspace. Here's what I found:                                                                
                                                                                                                                                      
  No existing PRD detected — this is a fresh workflow.                                                                                                
                                                                                                                                                      
  Input Documents Discovered:                                                                                                                         
                  
  - Product Briefs (2 found):                                                                                                                         
    - artifacts/planning-artifacts/product-brief-Ctxo.md
    - docs/product-brief-session.md                                                                                                                   
  - Research (1 found):
    - artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md
  - Project Docs (2 found):                                                                                                                           
    - docs/session-log-architecture-2026-03-28.md
    - docs/bmad-agent-architect-session.md                                                                                                            
  - Project Context: None found
                                                                                                                                                      
  I plan to load product-brief-Ctxo.md as the primary brief, the technical research document, and the architecture session doc. The                   
  product-brief-session.md appears to be a session log that may overlap with the main brief.                                                          
                                                                                                                                                      
  Do you have any other documents you'd like me to include, or shall I proceed with these? Once you confirm, I'll load them all and set up the PRD    
  workspace.
                                                                                                                                                      
  ---                                                                                                                                                 
  [C] Continue - Confirm this document set and move to Project Discovery (Step 2 of 11)
  ❯ c                                                                                                                                                   
                                                                                                                                                      
  Searched for 1 pattern, read 4 files (ctrl+o to expand)                                                                                             
                                                                                                                                                      
⏺ Good — all documents loaded. Now let me create the PRD file and move to Step 2.
                                                                                                                                                      
⏺ Write(artifacts/planning-artifacts/prd.md)                                                                                   
  ⎿  Wrote 18 lines to artifacts/planning-artifacts/prd.md                                                                                         
       1 ---                                                                                                                                          
       2 stepsCompleted: ['step-01-init']                                                                                                             
       3 inputDocuments:                                                                                                                              
       4   - 'artifacts/planning-artifacts/product-brief-Ctxo.md'                                                                                  
       5   - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'                                                               
       6   - 'docs/bmad-agent-architect-session.md'                                                                                                   
       7   - 'docs/product-brief-session.md'                                                                                                        
       8 workflowType: 'prd'                                                                                                                        
       9 briefCount: 2                                                                                                                                
      10 researchCount: 1                                                                                                                             
     … +8 lines (ctrl+o to expand)                                                                                                                    
                                                                                                                                                      
  Read 1 file (ctrl+o to expand)    
                                                                                                                                  
⏺ Now let me load the classification data.
                                                       
⏺ Step 2: Project Discovery                                                                                                                           
                                                                                                                                                      
  From step 1, I have loaded:                                                                                                                         
  - Product briefs: 2                                                                                                                                 
  - Research: 1                                                                                                                                       
  - Brainstorming: 0                                                                                                                                  
  - Project docs: 2                                                                                                                                   
                                                                                                                                                      
  This is a greenfield project — I'll help you define the full product vision.                                                                        
                                                                                                                                                      
  ---                                                                                                                                                 
  Having read through the product brief and research, here's my understanding before I ask you anything:                                              
                                                                                                                                                      
  Ctxo is an MCP server delivered as an npm package (npx ctxo) that gives AI coding assistants dependency-aware, intent-enriched context about a    
  codebase — a Logic-Slice engine built on ts-morph, tree-sitter, and SQLite. Five tools, local-only, index committed to git.                         
                                                                                                                                                    
  That maps cleanly to:                                                                                                                               
                                                                                                                                                    
  - Project Type: developer_tool — npm package, MCP server, API surface exposed to AI clients, no visual UI                                           
  - Domain: general (developer productivity) — no regulated industry, no compliance requirements                                                    
  - Complexity: High — novel protocol (MCP), type-aware AST analysis across file boundaries, real-time performance constraints (< 500ms p95),         
  multi-language extension architecture                                                                                                               
                                                                                                                                                      
  The only thing I'd probe before classifying: Is Ctxo intended as an open-source library (like ESLint/Prettier — free, community-driven, monetization
   TBD) or a commercial developer tool (paid tiers, enterprise licensing)? The product brief mentions both the OSS-like vision and leaves monetization
   unmentioned. This distinction shapes how we frame requirements around distribution, licensing, and adoption metrics.                               
                                                                                                                                                    
  Does the classification above sound right? And what's the current thinking on OSS vs commercial?                                                    
  
  ---                                                                                                                                                 
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Product Vision (Step 2b of 13)                                                  
 ❯ c                                                                                                                                                   
                                                                                                                                                      
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 1 line, removed 1 line                                                                                                                     
      1  ---                                                                                                                                          
      2 -stepsCompleted: ['step-01-init']                                                                                                             
      2 +stepsCompleted: ['step-01-init', 'step-02-discovery']                                                                                 
      3  inputDocuments:                                                                                                                              
      4    - 'artifacts/planning-artifacts/product-brief-Ctxo.md'
      5    - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'                                                                 
                                                                                                                                                    
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                    
  ⎿  Added 5 lines                                                                                                                                    
      10  researchCount: 1                                                                                                                            
      11  brainstormingCount: 0                                                                                                                       
      12  projectDocsCount: 2                                                                                                                         
      13 +classification:                                                                                                                             
      14 +  projectType: developer_tool                                                                                                             
      15 +  domain: general                                                                                                                           
      16 +  complexity: high                                                                                                                        
      17 +  projectContext: greenfield                                                                                                              
      18  ---                                                                                                                                         
      19                                                                                                                                              
      20  # Product Requirements Document - Ctxo                                                                                                      
                                                                                                                                                      
  Read 1 file (ctrl+o to expand)    
                                                                                                                                  
⏺ Step 2b: Product Vision Discovery
                                                                                                                                                      
  We've established Ctxo is a developer tool in the general domain with high complexity. Now let's explore what makes it special — before I write a   
  single word of the PRD.                                                                                                                             
                                                                                                                                                      
  The product brief already has a great tagline: "Other tools get the code. Ctxo gets the context." That's sharp. But I want to stress-test the vision
   from a few angles before we lock it in.                                                                                                            
                                                                                                                                                      
  A few things I want to understand better:                                                                                                         

  1. The differentiation moment — The brief describes the failure modes well (missing dependencies, missing history, missing risk signal). But when   
  does a user feel Ctxo working? Is it the first time the AI correctly avoids a pattern it previously would have repeated? The first PR that doesn't
  break a downstream service? Help me understand the "aha moment."                                                                                    
                                                                                                                                                    
  2. The core insight — The brief positions the committed JSON index as a team memory asset that grows over time. That's a strong and non-obvious     
  idea. Is that the central bet — that institutional memory as committed data is the real unlock? Or is the Logic-Slice (surgical dependency context
  in < 500ms) the thing you'd fight to protect if you had to cut scope?                                                                               
                                                                                                                                                    
  3. Why now — MCP is very new. Is the timing thesis "MCP adoption is early and Ctxo can become the default context layer before the space            
  consolidates"? Or is it more about AI coding assistants having hit a ceiling that only better context can break?
                                                                                                                                                      
  You don't need to answer all three — just tell me what feels most true to you. I'll reflect back what I'm hearing.                                  


   ❯ c                                                                                                                                                   
                                                                                                                                                      
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 1 line, removed 1 line                                                                                                                     
      1  ---                                                                                                                                          
      2 -stepsCompleted: ['step-01-init']                                                                                                             
      2 +stepsCompleted: ['step-01-init', 'step-02-discovery']                                                                                 
      3  inputDocuments:                                                                                                                              
      4    - 'artifacts/planning-artifacts/product-brief-Ctxo.md'
      5    - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'                                                                 
                                                                                                                                                    
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                    
  ⎿  Added 5 lines                                                                                                                                    
      10  researchCount: 1                                                                                                                            
      11  brainstormingCount: 0                                                                                                                       
      12  projectDocsCount: 2                                                                                                                         
      13 +classification:                                                                                                                             
      14 +  projectType: developer_tool                                                                                                             
      15 +  domain: general                                                                                                                           
      16 +  complexity: high                                                                                                                        
      17 +  projectContext: greenfield                                                                                                              
      18  ---                                                                                                                                         
      19                                                                                                                                              
      20  # Product Requirements Document - Ctxo                                                                                                      
                                                                                                                                                      
  Read 1 file (ctrl+o to expand)    
                                                                                                                                  
⏺ Step 2b: Product Vision Discovery
                                                                                                                                                      
  We've established Ctxo is a developer tool in the general domain with high complexity. Now let's explore what makes it special — before I write a   
  single word of the PRD.                                                                                                                             
                                                                                                                                                      
  The product brief already has a great tagline: "Other tools get the code. Ctxo gets the context." That's sharp. But I want to stress-test the vision
   from a few angles before we lock it in.                                                                                                            
                                                                                                                                                      
  A few things I want to understand better:                                                                                                         

  1. The differentiation moment — The brief describes the failure modes well (missing dependencies, missing history, missing risk signal). But when   
  does a user feel Ctxo working? Is it the first time the AI correctly avoids a pattern it previously would have repeated? The first PR that doesn't
  break a downstream service? Help me understand the "aha moment."                                                                                    
                                                                                                                                                    
  2. The core insight — The brief positions the committed JSON index as a team memory asset that grows over time. That's a strong and non-obvious     
  idea. Is that the central bet — that institutional memory as committed data is the real unlock? Or is the Logic-Slice (surgical dependency context
  in < 500ms) the thing you'd fight to protect if you had to cut scope?                                                                               
                                                                                                                                                    
  3. Why now — MCP is very new. Is the timing thesis "MCP adoption is early and Ctxo can become the default context layer before the space            
  consolidates"? Or is it more about AI coding assistants having hit a ceiling that only better context can break?
                                                                                                                                                      
  You don't need to answer all three — just tell me what feels most true to you. I'll reflect back what I'm hearing.                                  
   
❯ Ctxo: From "Dumb Pipes" to "Neural Context"                                                                                                         
Mevcut AI araçlarının (MCP sunucuları, indeksleme araçları) en büyük günahı, kodu sadece metin (string) olarak görmeleridir. Bu araçlar AI'ya koca    
bir kütüphaneyi "al hepsini oku" diyerek fırlatan, verimsiz ve "aptal borulardır" (Dumb Pipes).                                                       
                                                                                                                                                      
Ctxo bu paradigmayı yıkar. Ctxo bir dosya okuyucu değil; kodun sinir sistemini (nervous system) anlayan bir Bağlam Motorudur (Context Engine).        
                                                                                                                                                      
💎 The Differentiation: Why Ctxo?                                                                                                                     
Ctxo, geliştiricinin zihnindeki "bağlam haritası" ile AI'nın "bilgi penceresi" arasındaki o devasa boşluğu şu üç temel farkla doldurur:               
                                                                                                                                                      
Surgical Logic-Slicing (The Death of "Missing Type" Errors):                                                                                          
Standart araçlar bir fonksiyonu çeker ve AI'yı "tip tanımları eksik" uyarısıyla baş başa bırakır. Ctxo, AST (Abstract Syntax Tree) analizi yaparak o  
fonksiyonun dokunduğu her bir Interface, Type ve Helper fonksiyonunu farklı dosyalarda olsalar bile tek bir "mantıksal dilim" (Logic-Slice) halinde   
paketler. AI artık kör uçuşu yapmaz; ihtiyacı olan her şey elindedir.                                                                                 
                                                                                                                                                      
Historical Consciousness (The "Why" Behind the Code):                                                                                                 
Kod sadece satırlardan ibaret değildir; bir geçmişi vardır. Ctxo, Git geçmişini doğrudan bağlama entegre eder. AI'ya sadece "ne yazdığını" değil,     
"neden yazdığını" (commit mesajları, PR tartışmaları) söyler. Bu, AI'nın 3 ay önce bir bug'ı çözmek için eklenen kritik bir kontrolü yanlışlıkla      
silmesini engeller.                                                                                                                                   
                                                                                                                                                      
Risk-Aware Intelligence (The Downstream Guardrail):                                                                                                   
Rakipler sadece "isteneni" yapar. Ctxo ise projenin bağımlılık grafiğini bildiği için AI'yı uyarır: "Bu değişikliği yapabilirim ama bu fonksiyon 12   
farklı kritik modülü etkiliyor, güvenli bir refactor öneriyorum."                                                                                     
                                                                                                                                                      
✨ The "Aha!" Moment: When the Magic Happens                                                                                                          
Kullanıcı Ctxo'nun gücünü şu anlarda hisseder:                                                                                                        
                                                                                                                                                      
The "Mind-Reader" Moment: AI'ya "şu fonksiyonu güncelle" dediğinde, AI'nın senden hiçbir ekstra dosya istemeden, projenin en ücra köşesindeki tip     
tanımlarına kadar her şeyi bildiğini fark ettiğin an.                                                                                                 
                                                                                                                                                      
The "PR-Saver" Moment: AI'nın seni durdurup, "Bu değişikliği yaparsak v1.2'de çözülen güvenlik açığı geri dönebilir, Git geçmişinde şöyle bir not     
var" dediği o kırılma anı.                                                                                                                            
                                                                                                                                                      
The "Zero-Noise" Moment: Binlerce satırlık dosyalar yerine sadece 50 satırlık ama "tam isabet" bir bağlamla, AI'nın ilk denemede (one-shot) hatasız   
kod ürettiği an.                                                                                                                                      
                                                                                                                                                      
🚀 Conclusion: The Partner vs. The Tool                                                                                                               
Ctxo, AI'yı yönettiğin bir araç olmaktan çıkarıp, seninle aynı "kod hafızasına" sahip bir partnere dönüştürür.                                        
                                                                                                                                                      
Eski Dünya: "AI, şu 5 dosyayı oku, sonra bu fonksiyonu düzelt, ama tip hatası alırsan şu dosyaya da bak..."                                           
                                                                                                                                                      
Ctxo Dünyası: "AI, şu özelliği ekle." -> Done. With full context, zero risk, and surgical precision.Durum,Eski Dünya (AI + Standart MCP),Yeni Dünya   
(AI + Ctxo)                                                                                                                                           
Bağlam,"AI ""Dosya eksik"" diye ağlar.",AI ihtiyacı olanı sessizce çeker.                                                                             
Hata,Yan etkileri (side-effects) göremez.,"""Bunu değiştirirsen şunlar bozulur"" der."                                                                
Maliyet,Dosyanın tamamını okur (Token 💸).,Sadece ilgili dilimi okur (Token 🪙 ).                                                                      
İletişim,Sen AI'yı yönetirsin.,AI seni yönlendirir.                                                                                                   



⏺ That's the clearest articulation of the vision I've seen yet — and it sharpens several things from the brief. Let me reflect back what I'm hearing:
                                                                                                                                  
  ---                                                                                                                                                 
  Vision: Ctxo transforms AI coding assistants from "dumb pipes" (tools that dump raw text at an AI and hope for the best) into a Neural Context layer
   — a Context Engine that understands the nervous system of code, not just its syntax.                                                               
                                                                                                                                                      
  What Makes It Special:                                                                                                                              
  Three things working together that no other tool does simultaneously:
  1. Surgical Logic-Slicing — AST-powered packaging of a symbol + every Interface, Type, and Helper it touches across files. Eliminates "missing type"
   errors at the root.                                                                                                                                
  2. Historical Consciousness — Git history as first-class context. The AI knows why code exists, not just what it is — preventing the quiet erasure  
  of critical bug fixes and security patches.                                                                                                         
  3. Risk-Aware Intelligence — Blast radius awareness before action. AI becomes a downstream guardrail, not just an executor.                         
                                                                                                                             
  The "Aha" Moments (3 distinct ones):                                                                                                                
  - Mind-Reader: AI modifies the function you asked about — with zero extra prompting, zero missing types, zero file-hunting.                         
  - PR-Saver: AI stops itself and says "this change risks reintroducing the v1.2 security vulnerability — here's the git note."                       
  - Zero-Noise: 50 lines of surgical context → one-shot correct output. No token burn on irrelevant code.                                             
                                                                                                                                                      
  Core Insight: The paradigm shift isn't about better search or faster indexing. It's about shifting the relationship: from you managing the AI → the 
  AI guiding you, because it holds the same code memory you do.                                                                                       
                                                                                                                                                      
  Why Now: MCP is the emerging standard for AI↔tool communication. The window to become the default context layer — before the space consolidates —   
  is open right now.
                                                                                                                                                      
  ---                                                                                                                                               
  Does this capture it? Anything missing or off?
                                                
  ---
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Executive Summary (Step 2c of 13)                                                 
                                                                                                                                                      
❯ c                                                                                                                                                                                                                                                                                    
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 1 line, removed 1 line                                                                                                                     
      1  ---                                                                                                                                          
      2 -stepsCompleted: ['step-01-init', 'step-02-discovery']                                                                                        
      2 +stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision']                                                                     
      3  inputDocuments:                                                                                                                              
      4    - 'artifacts/planning-artifacts/product-brief-Ctxo.md'
      5    - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'                                                                 
                                                                                                                                                    
  Read 1 file (ctrl+o to expand)                                                                                                                    
                                                                                                                                                      
⏺ Step 2c: Executive Summary Generation                                                                                                               
                                                                                                                                                      
  Here's the Executive Summary I've drafted based on our discovery work. Please review:                                                               
                                                                                                                                                      
  ---                                                                                                                                                 
  Executive Summary                                                                                                                                   
                                                                                                                                                      
  AI coding assistants have a context problem. They receive code as flat text — blind to the dependency graph it lives in, the git history behind     
  every decision, and the blast radius of every change. The result is a capable AI operating with the situational awareness of someone who just cloned
   the repo 30 seconds ago.
                                                                                                                                                      
  Ctxo is a Model Context Protocol (MCP) server that closes this gap. It transforms AI assistants from dumb pipes — tools that dump raw files and hope
   the AI figures it out — into a Neural Context layer: a Context Engine that understands the nervous system of a codebase, not just its syntax.    
                                                                                                                                                      
  Ctxo runs entirely on the developer's machine. Its index is committed to the repository as per-file JSON, diffable in PRs, shareable via git pull,  
  and queryable in under 500ms. A fresh git clone is immediately context-rich. The AI gets the codebase's institutional memory, not just its current
  state.                                                                                                                                              
                                                                                                                                                    
  Target users: senior and mid-level developers who have hit the ceiling of what AI coding assistants can do without deeper context — developers      
  who've seen the AI confidently break something it didn't know existed.
                                                                                                                                                      
  What Makes This Special                                                                                                                           

  Three capabilities, working together, that no other MCP tool delivers simultaneously:                                                               
   
  Surgical Logic-Slicing. AST-powered dependency resolution that packages a symbol with every Interface, Type, and Helper it touches across files —   
  delivered as a single Logic-Slice. Eliminates "missing type" errors at the root. The AI gets exactly what it needs; nothing more.                 
                                                                                                                                                      
  Historical Consciousness. Git history as first-class context. The AI knows not just what code does, but why it was written that way — commit intent,
   revert warnings, abandoned approaches. Prevents the quiet erasure of critical bug fixes and security patches.
                                                                                                                                                      
  Risk-Aware Intelligence. Blast radius awareness before action. Before modifying a symbol depended on by 34 other modules, the AI knows it — and can 
  recommend a safe refactor path rather than a confident breaking change.
                                                                                                                                                      
  The "aha" moments users describe: the AI modifying a function with zero missing-type prompts (Mind-Reader); the AI stopping to warn that a change   
  risks reintroducing a v1.2 security vulnerability it found in git history (PR-Saver); 50 lines of surgical context producing one-shot correct output
   where a brute-force file dump failed (Zero-Noise).                                                                                                 
                                                                                                                                                    
  The paradigm shift: from you managing the AI → the AI guiding you, because it holds the same code memory you do.                                    
   
  Project Classification                                                                                                                              
                                                                                                                                                    
  - Project Type: Developer Tool (MCP server, npm package)                                                                                            
  - Domain: Developer Productivity (general — no regulated industry)
  - Complexity: High — novel protocol integration (MCP), type-aware cross-file AST analysis, real-time performance constraints (< 500ms p95),         
  multi-language extension architecture                                                                                                               
  - Project Context: Greenfield
                                                                                                                                                      
  ---                                                                                                                                               
  Changes you'd like, or ready to lock it in?
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Success Criteria (Step 3 of 13)
  Read 1 file (ctrl+o to expand)                                                                                                                      
                                                                                                                                                      
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 1 line, removed 1 line                                                                                                                     
      1  ---                                                                                                                                          
      2 -stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision']                                                                     
      2 +stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary']                                       
      3  inputDocuments:                                                                                                                              
      4    - 'artifacts/planning-artifacts/product-brief-Ctxo.md'                                                                                  
      5    - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'                                                                 
                                                                                                                                                    
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                    
  ⎿  Added 32 lines, removed 1 line                                                                                                                   
      20  # Product Requirements Document - Ctxo                                                                                                      
      21                                                                                                                                              
      22  **Author:** Alper Hankendi                                                                                                                  
      23 -**Date:** 2026-03-28                                                                                                                        
      23   No newline at end of file                                                                                                                
      24 +**Date:** 2026-03-28                                                                                                                        
      25 +                                                                                                                                          
      26 +## Executive Summary                                                                                                                      
      27 +                                                                                                                                            
      28 +AI coding assistants have a context problem. They receive code as flat text — blind to the dependency graph it lives in, the git hist       
         +ory behind every decision, and the blast radius of every change. The result is a capable AI operating with the situational awareness        
         +of someone who just cloned the repo 30 seconds ago.                                                                                         
      29 +                                                                                                                                     
      30 +**Ctxo** is a Model Context Protocol (MCP) server that closes this gap. It transforms AI assistants from dumb pipes — tools that dump
         + raw files and hope the AI figures it out — into a Neural Context layer: a Context Engine that understands the nervous system of a co
         +debase, not just its syntax.                                                                                                         
      31 +                                                                                                                                     
      32 +Ctxo runs entirely on the developer's machine. Its index is committed to the repository as per-file JSON, diffable in PRs, shareable 
         +via `git pull`, and queryable in under 500ms. A fresh `git clone` is immediately context-rich. The AI gets the codebase's institution
         +al memory, not just its current state.                                                                                               
      33 +                                                                                                                                     
      34 +Target users: senior and mid-level developers who have hit the ceiling of what AI coding assistants can do without deeper context — d
         +evelopers who've seen the AI confidently break something it didn't know existed.                                                     
      35 +                                                                                                                                     
      36 +### What Makes This Special                                                                                                          
      37 +                                                                                                                                     
      38 +Three capabilities, working together, that no other MCP tool delivers simultaneously:                                                
      39 +                                                                                                                                     
      40 +**Surgical Logic-Slicing.** AST-powered dependency resolution that packages a symbol with every Interface, Type, and Helper it touche
         +s across files — delivered as a single Logic-Slice. Eliminates "missing type" errors at the root. The AI gets exactly what it needs; 
         +nothing more.                                                                                                                        
      41 +                                                                                                                                     
      42 +**Historical Consciousness.** Git history as first-class context. The AI knows not just *what* code does, but *why* it was written th
         +at way — commit intent, revert warnings, abandoned approaches. Prevents the quiet erasure of critical bug fixes and security patches.
      43 +                                                                                                                                     
      44 +**Risk-Aware Intelligence.** Blast radius awareness before action. Before modifying a symbol depended on by 34 other modules, the AI 
         +knows it — and can recommend a safe refactor path rather than a confident breaking change.                                           
      45 +                                                                                                                                     
      46 +The "aha" moments users describe: the AI modifying a function with zero missing-type prompts (Mind-Reader); the AI stopping to warn t
         +hat a change risks reintroducing a v1.2 security vulnerability it found in git history (PR-Saver); 50 lines of surgical context produ
         +cing one-shot correct output where a brute-force file dump failed (Zero-Noise).                                                      
      47 +                                                                                                                                     
      48 +The paradigm shift: from *you managing the AI* → *the AI guiding you*, because it holds the same code memory you do.                 
      49 +                                                                                                                                     
      50 +## Project Classification                                                                                                            
      51 +                                                                                                                                     
      52 +- **Project Type:** Developer Tool (MCP server, npm package)                                                                         
      53 +- **Domain:** Developer Productivity (general — no regulated industry)                                                               
      54 +- **Complexity:** High — novel protocol integration (MCP), type-aware cross-file AST analysis, real-time performance constraints (< 5
         +00ms p95), multi-language extension architecture                                                                                     
      55 +- **Project Context:** Greenfield                                                                                                    
      56   No newline at end of file

  Read 1 file (ctrl+o to expand)    
                                                                                                                                  
⏺ Step 3: Success Criteria Definition
                                                                                                                                                      
  The product brief already has solid success indicators — let me surface them and then push for sharper specificity where needed.                    
                                                                                                                                                      
  From the brief, you've already defined:                                                                                                             
  - Performance: Context delivery < 500ms p95 (1,000-file TS codebase), MCP server startup < 100ms                                                    
  - Adoption: Index committed and shared by majority of multi-developer teams using Ctxo; CI indexing pattern adopted by early enterprise users       
  - Quality: Reduction in AI-generated changes requiring immediate revert (measurable via git history)                                                
  - Ecosystem: Verified compatibility with Claude Code, Cursor, VS Code Copilot at V1 launch                                                          
                                                                                                                                                      
  These are good. Let me probe the gaps:                                                                                                              
                                                                                                                                                      
  1. User success — The "Zero-Noise" and "PR-Saver" moments you described are compelling, but what does measurable user success look like? For a      
  developer tool, common signals are: time-to-first-value (how fast does a new user get their first Logic-Slice working?), return usage (do they keep 
  coming back?), and reduction in back-and-forth prompting cycles. Which of these matter most to you?                                                 
                                                                                                                                                    
  2. Adoption specificity — "Majority of multi-developer teams" is hard to measure. What's a concrete 3-month target? Something like: "10 teams with  
  ≥3 developers have the index committed to their main branch" is trackable. What number feels right for early validation?
                                                                                                                                                      
  3. Business success — The brief doesn't mention monetization. For PRD purposes I don't need a business model decision, but I do need to know: is V1 
  success defined purely by adoption/usage metrics, or is there a revenue/conversion target that shapes what we build?
                                                                                                                                                      
  4. The quality metric — "Reduction in AI-generated changes requiring immediate revert" is excellent and measurable. Do you have a baseline estimate,
   or is this an instrumentation-first problem (i.e., we need Ctxo users who consent to share git analytics before we can measure it)?
                                                                                                                                                      
  Answer whichever of these feels most important — I'll shape the success criteria around your answers.                                               

````
🚀 Project Brief: Ctxo
Ctxo is a Logic-Slice based MCP server that gives AI agents a "senior developer’s brain." Instead of dumping raw files, it surgically extracts the code’s nervous system (dependencies) and memory (history).

🎯 The "Aha!" Moment
Users feel Ctxo working when the AI stops saying "I don't see the definition for Type X" and starts saying "I updated the function and verified its related interfaces and Git history to ensure no breaking changes." It turns the AI from a tool you manage into a partner that navigates the code for you.

🛠 Core Capabilities
Logic-Slicing: Automatically bundles a function with its required types and helpers from other files.

Historical Context: Injects Git commit "whys" into the AI's prompt.

Risk Radar: Warns the AI about downstream impacts before it makes a change.
````                     


⏺ That crystallizes the "aha moment" perfectly. Combined with the product brief's existing metrics, here's the full success criteria draft:
                                                                                                                                  
  ---
  Success Criteria                                                                                                                                    
   
  User Success                                                                                                                                        
                                                                                                                                                    
  - Mind-Reader Moment achieved: In a Ctxo-enabled session, the AI never asks "I don't see the definition for Type X" — all required interfaces,      
  types, and helpers are present in the Logic-Slice without manual file-fetching by the user.
  - Time to first value: A developer installs Ctxo, runs npx ctxo index, and receives their first Logic-Slice response within 5 minutes of a fresh    
  clone.                                                                                                                                              
  - Zero-Noise output: Logic-Slice context is ≤ 50–150 lines for the majority of symbol queries (vs. full file dumps that span hundreds of lines),
  reducing prompt token cost while increasing relevance.                                                                                              
  - PR-Saver moment: For codebases with revert commits in git history, get_why_context surfaces anti-pattern warnings in at least one AI session per
  team per sprint.                                                                                                                                    
                                                                                                                                                    
  Business Success                                                                                                                                    
                                                                                                                                                    
  - 3-month target: 10+ multi-developer teams (≥ 3 devs) with the .ctxo/index/ committed to their main branch and actively used in CI.                
  - Ecosystem adoption: Listed as a recommended MCP server in at least one Claude Code or Cursor community resource by V1 launch.
  - Monetization: V1 is open-source / free — success is measured purely by adoption and usage signals. Revenue strategy is out of scope for this PRD. 
                                                                                                                                                      
  Technical Success                                                                                                                                   
                                                                                                                                                      
  - Performance: Context delivery < 500ms p95 on a warm index (1,000-file TypeScript codebase). MCP server startup < 100ms (lazy initialization).     
  - Compatibility: All five MCP tools verified functional with Claude Code, Cursor, and VS Code Copilot at V1 launch.
  - Index integrity: Incremental re-indexing on file change completes in < 2s. Index format is text-based, diffable, and produces no merge conflicts  
  on git pull.                                                                                                                                        
  - Privacy: Zero sensitive data (API keys, credentials, private IPs) reaches the MCP client — privacy masking pipeline validated against a test      
  fixture set.                                                                                                                                        
                                                                                                                                                    
  Measurable Outcomes                                                                                                                                 
                                                                                                                                                    
  - Reduction in AI-generated changes requiring immediate revert — baseline established via git history analysis with 3+ willing early adopter teams  
  post-launch (instrumentation-first; no pre-launch baseline assumed).
  - Token consumption per AI session reduced vs. file-dump approach — measured by comparing context window usage with/without Ctxo in controlled test 
  scenarios.                                                                                                                                          
  
  Product Scope                                                                                                                                       
                                                                                                                                                    
  MVP — Minimum Viable Product (V1, TypeScript/JavaScript)                                                                                            
  
  Five MCP tools fully functional: get_logic_slice, get_blast_radius, get_architectural_overlay, get_why_context, get_change_intelligence. Progressive
   detail levels L1–L4. Privacy masking pipeline. Committed JSON index (.ctxo/index/). Incremental file watching. Monorepo auto-discovery. CI indexing
   gate (GitHub Actions). npx ctxo install. Verified compatibility: Claude Code, Cursor, VS Code Copilot.                                             
                                                                                                                                                    
  Growth Features (Post-MVP)

  Go + C# language support via tree-sitter syntax-level adapters (V1.5). IDE extension for one-click install. Dashboard for index health and blast    
  radius visualization. Team analytics (opt-in): aggregate revert reduction metrics.
                                                                                                                                                      
  Vision (V2+)                                                                                                                                        
  
  Go deep analysis via gopls MCP composition. C# deep analysis via Roslyn LSP adapter. Multi-repo / cross-service dependency graphs. Natural language 
  query interface over the index. Ctxo becomes the default context layer — .ctxo/index/ as unremarkable as .github/workflows/.                      
                                                                                                                                                      
  ---                                                                                                                                               
  Any refinements, or does this capture it?
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to User Journey Mapping (Step 4 of 13)
                                                                                                                                                      
✻ Cooked for 33s                                                                                                                                    
                                                                                                                                                      
❯ c                                                                                                                                                   
                                                                                                                                                      
✻ Herding… (thought for 1s)                                                                                                                           
  ⎿  Tip: Open the Command Palette (Cmd+Shift+P) and run "Shell Command: Install 'code' command in PATH" to enable IDE integration                    
                                                                                                                                                      
──────────────────

⏺ Step 4: User Journey Mapping
                                                                                                                                                      
  The product brief has two clear personas: primary (senior/mid-level developer on AI-assisted complex codebases) and secondary (engineering teams    
  managing knowledge continuity). Since Ctxo is a developer tool with no admin UI, the "user types" are narrower than a typical SaaS — but there are  
  still distinct journeys worth mapping.                                                                                                              
                                                                                                                                                      
  Here are the journeys I'll draft, then you can tell me what to keep, cut, or add:                                                                   
                                                                                                                                                      
  1. The Solo Developer — First Context Slice (primary, success path): Gets Ctxo working on their own codebase, hits the Mind-Reader moment for the   
  first time.                                                                                                                                       
  2. The Team Lead — Committing the Index (primary, team adoption): Decides to commit .ctxo/index/ to the repo and wire up CI, turning a personal tool
   into a team asset.                                                                                                                                 
  3. The New Joiner — Day-One Onboarding (secondary, knowledge continuity): Joins a team that already has Ctxo. The index is already there on git 
  clone — institutional memory on arrival.                                                                                                            
  4. The Developer — Edge Case / Failure Recovery (primary, error path): Index is stale, or a query returns incomplete context — what happens, what 
  they see, how they recover.                                                                                                                         
                                                                                                                                                    
  Does this set cover what you want? Any persona missing — for instance, should I include a CI engineer wiring up the GitHub Actions gate? Or an OSS  
  contributor extending Ctxo with a new language adapter?                                                                                           
                                                                                                                                                      
  Once you confirm the persona set, I'll write the full narrative journeys.                                                                           
  
✻ Sautéed for 35s                                                                                                                            ⏺ Here are the four narrative journeys:                                                                                                               
                                                                                                                                                      
  ---                                                                                                                                                 
  User Journeys                                                                                                                                       
   
  Journey 1: The Solo Developer — First Context Slice                                                                                                 
                  
  Meet Mia. She's a senior frontend developer at a 12-person startup. Her team shipped fast for two years; the codebase is now 800 files of TypeScript
   and nobody has a complete map of it anymore. She uses Claude Code daily but spends 20% of every AI session doing file archaeology — "also look at
  this file... and this one... and this interface." Last week the AI confidently refactored useAuthToken without knowing it was consumed by three     
  other hooks. The PR review caught it. Barely.

  She finds Ctxo in the Claude Code MCP server list. Thirty seconds:                                                                                  
   
  npx ctxo index                                                                                                                                      
                  
  Index builds in 18 seconds. She adds the one-line MCP config and reloads Claude Code.                                                               
   
  She asks Claude to update useAuthToken. No file-hunting. No "I don't see the definition for TokenValidationResult." Claude responds: "I've updated  
  the hook and verified its contract against IAuthProvider, TokenValidationResult, and the three consuming hooks — no breaking changes."
                                                                                                                                                      
  That's the moment. She opens Slack and sends her team lead a message: "You need to see this."                                                       
   
  Capabilities revealed: get_logic_slice (L2 depth), MCP stdio transport, warm-index query performance, Claude Code compatibility.                    
                  
  ---                                                                                                                                                 
  Journey 2: The Team Lead — Committing the Index
                                                 
  Meet Daniel. He's a tech lead on a 6-person backend team. Mia sent him the Slack message. He tries Ctxo on his machine and hits the same moment. But
   he's thinking bigger: "What if everyone on the team had this — and what if it accumulated over time?"                                              
   
  He reads about the committed index pattern. He runs npx ctxo index, reviews the .ctxo/index/ output — one JSON file per source file, 3.2MB total,   
  fully text-based. He opens a sample file: readable, diffable, reasonable. He adds .ctxo/cache/ to .gitignore, commits .ctxo/index/, and opens a PR.
                                                                                                                                                      
  The PR description writes itself: "Adds Ctxo index — gives AI assistants full dependency context on this codebase. Pull and you're context-rich     
  immediately."
                                                                                                                                                      
  He adds the GitHub Actions CI gate. Now every PR that modifies source files triggers npx ctxo index --check — the CI fails if the index is stale.   
  Institutional memory stays current automatically.
                                                                                                                                                      
  Three weeks later a new hire, Priya, clones the repo. She has full context on her first day. Daniel never has to explain the PaymentProcessor       
  dependency graph again.
                                                                                                                                                      
  Capabilities revealed: git commit index pattern, .gitignore cache separation, CI indexing gate (GitHub Actions), incremental re-indexing, monorepo  
  auto-discovery.
                                                                                                                                                      
  ---             
  Journey 3: The New Joiner — Day-One Onboarding
                                                
  Meet Priya. She joined Daniel's team two weeks ago. The codebase is 1,200 files. She's been given a ticket: add rate limiting to the ApiGateway
  service.                                                                                                                                            
   
  Old world: she'd spend half a day reading files, asking colleagues "what does this touch?", making a change that looks right but breaks             
  MetricsCollector downstream.
                                                                                                                                                      
  Ctxo world: she runs git clone. The .ctxo/index/ is already there. She opens Claude Code, types: "I need to add rate limiting to ApiGateway — what's
   the blast radius?"
                                                                                                                                                      
  Claude responds with the architectural overlay for the gateway layer, the five downstream services that depend on it, and a note from git history:  
  "Rate limiting was attempted in commit 3a7f91 eight months ago and reverted — the implementation used a shared mutex that caused deadlocks under 
  load. Recommend token bucket per-connection instead."                                                                                               
                  
  Priya didn't know that history existed. Nobody told her. The codebase told her.                                                                     
   
  Capabilities revealed: get_blast_radius, get_why_context, get_architectural_overlay, anti-pattern memory from revert commits, committed index shared
   via git clone. 
                                                                                                                                                      
  ---             
  Journey 4: The Developer — Edge Case / Stale Index Recovery
                                                             
  Meet Carlos. He's been using Ctxo for a month. It's become invisible — he forgets it's there until the AI demonstrates something impossible. Today
  something goes wrong.                                                                                                                               
   
  He runs a Logic-Slice query on InvoiceGenerator. The response is missing TaxCalculator — a dependency he knows exists. He checks: he's been on a    
  feature branch for three days, added TaxCalculator yesterday, never re-ran the index.
                                                                                                                                                      
  Ctxo surfaces a warning in the MCP response: "Index for invoice-generator.ts is 3 days old and may not reflect recent changes. Run npx ctxo index   
  --file src/billing/invoice-generator.ts to update."
                                                                                                                                                      
  He runs the incremental update. Two seconds. The next query includes TaxCalculator. He files a mental note: "Wire up the file watcher so this never 
  happens again." He adds npx ctxo watch to his dev startup script.
                                                                                                                                                      
  Capabilities revealed: Index staleness detection, incremental file-level re-indexing, ctxo watch file watcher, graceful degradation with            
  user-actionable warnings.
                                                                                                                                                      
  ---             
  Journey Requirements Summary
                                                                                                                                                      
  ┌──────────────────────────────────────────────────────────┬──────────────┐
  │                     Capability Area                      │ Revealed By  │                                                                         
  ├──────────────────────────────────────────────────────────┼──────────────┤
  │ get_logic_slice (L1–L4 progressive depth)                │ Journey 1    │
  ├──────────────────────────────────────────────────────────┼──────────────┤
  │ MCP stdio transport, Claude Code / Cursor compatibility  │ Journey 1    │                                                                         
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ Warm-index query performance (< 500ms)                   │ Journey 1    │                                                                         
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ Committed JSON index, .gitignore cache separation        │ Journey 2    │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ CI indexing gate (GitHub Actions)                        │ Journey 2    │
  ├──────────────────────────────────────────────────────────┼──────────────┤
  │ Incremental re-indexing on file change                   │ Journey 2, 4 │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ get_blast_radius                                         │ Journey 3    │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ get_why_context + anti-pattern memory (revert detection) │ Journey 3    │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ get_architectural_overlay                                │ Journey 3    │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ Index staleness detection + actionable warnings          │ Journey 4    │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ ctxo watch file watcher                                  │ Journey 4    │
  ├──────────────────────────────────────────────────────────┼──────────────┤                                                                         
  │ Monorepo auto-discovery                                  │ Journey 2    │
  └──────────────────────────────────────────────────────────┴──────────────┘                                                                         
                  
  ---
  Looks right to you?
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Domain Requirements (Step 5 of 13)         
                                                                                              
⏺ Step 5: Domain-Specific Requirements
                                                                                                                                                      
  Our classification from Step 2: domain = general (developer productivity), complexity = high.                                                       
                                                                                                                                                      
  The complexity is high due to technical factors (novel protocol, AST analysis, real-time constraints) — not regulatory factors. There are no        
  compliance regimes (HIPAA, PCI-DSS, GDPR processing, etc.) that apply here. The domain-specific concerns for Ctxo are really technical constraints, 
  which we'll cover fully in the functional requirements step.                                                                                        
                                                                                                                                                      
  The one domain concern worth calling out explicitly: privacy. Ctxo processes source code — which may contain secrets, credentials, and proprietary  
  business logic. The privacy masking pipeline isn't just a feature; it's a trust prerequisite for adoption, especially in enterprise environments.
  We've already captured this in success criteria.                                                                                                    
                                                                                                                                                    
  I'll skip appending a formal Domain Requirements section (nothing meaningful to add beyond what's already in scope) and move straight to Innovation.
  
  Select: [C] Continue to Innovation Focus (Step 6 of 13)                                                                                             
                                                                                                                                                    
✻ Cooked for 53s                                                                         
⏺ Step 6: Innovation Discovery
                                                                                                                                                      
  Innovation signals are strongly present. From the developer_tool classification, the signal is "New paradigm" — and Ctxo hits it squarely. Let me   
  map what's genuinely novel here:                                                                                                                    
                                                                                                                                                      
  Detected innovation areas:                                                                                                                          
                                                                                                                                                      
  1. Logic-Slice as a new paradigm for context delivery. Every existing MCP server for code (file readers, symbol search, grep tools) operates at the 
  file or token level. Ctxo operates at the semantic dependency graph level — a fundamentally different unit of context. This is the "new paradigm"
  signal.                                                                                                                                             
  2. Institutional memory as committed data. The idea that a codebase's intent graph (not just its code) should live in git, accumulate over time, and
   be shared via git pull — this is novel. No existing tool treats the AI's context layer as a team asset that compounds. ESLint's .eslintrc doesn't  
  grow smarter over time. Ctxo's index does.
  3. Anti-pattern memory from revert commits. Surfacing "this was tried and abandoned — here's why" from git history is a capability that no other    
  tool provides. The AI inherits institutional memory that survives team turnover.                                                                    
  4. Composable MCP architecture. The V2 pattern of composing with gopls and Roslyn as peer MCP servers (rather than reimplementing language analysis)
   is a novel approach to multi-language extensibility in the MCP ecosystem.                                                                          
                                                                                                                                                    
  Here's the draft innovation section:                                                                                                                
                                                                                                                                                    
  ---
  Innovation & Novel Patterns

  Detected Innovation Areas

  New paradigm: Semantic dependency context over file context. Ctxo introduces the Logic-Slice as the fundamental unit of AI context delivery — a     
  symbol plus its complete transitive dependency graph (interfaces, types, helpers), assembled at query time from a pre-built index. This replaces
  file-level context delivery, which is the universal approach of all current MCP servers and AI code tools. The paradigm shift: the AI receives the  
  minimum sufficient context to reason correctly, not the maximum available text from surrounding files.                                            

  Institutional memory as a committed team asset. The .ctxo/index/ pattern treats AI context as a versioned, diffable, git-managed artifact. This is  
  distinct from all existing approaches (in-memory indexing, ephemeral caches, per-session context building). Every git pull delivers accumulated team
   knowledge — architectural decisions, anti-patterns, blast radius data — to every developer and AI agent on the team. Context compounds over time.  
                                                                                                                                                    
  Anti-pattern memory from revert commit detection. By parsing git history for revert commits and attaching the associated rationale to affected      
  symbols, Ctxo gives AI assistants access to negative knowledge — approaches that were tried, failed, and abandoned. This capability has no known
  equivalent in the MCP ecosystem.                                                                                                                    
                                                                                                                                                    
  Market Context & Competitive Landscape

  The MCP ecosystem is early (protocol released late 2024). Current MCP servers for code are primarily file readers and symbol search tools — none    
  provide dependency-graph-level context. The committed index pattern has no direct competitor. The timing window to establish Ctxo as the default
  context layer is open now, before the space consolidates around file-dump approaches.                                                               
                                                                                                                                                    
  Closest adjacent tools (Sourcegraph Cody, GitHub Copilot workspace context, Cursor's codebase indexing) operate as SaaS with cloud-side indexing —  
  the opposite of Ctxo's local-first, git-committed architecture. This is both a differentiation and a positioning advantage for security-conscious
  teams.                                                                                                                                              
                                                                                                                                                    
  Validation Approach

  - Logic-Slice validity: Controlled comparison — same query with Ctxo vs. file-dump approach, measuring: (a) missing type errors in AI output, (b)   
  token usage, (c) first-attempt correctness rate. Target: measurable improvement in all three.
  - Committed index pattern: Adoption signal — teams that commit the index and use CI gate vs. those that don't. Track index staleness rate as proxy  
  for CI gate value.                                                                                                                                  
  - Anti-pattern memory: Qualitative validation with early adopters — does surfacing revert history change AI behavior in measurable ways?
                                                                                                                                                      
  Risk Mitigation                                                                                                                                   
                                                                                                                                                      
  - Index staleness: Mitigated by CI gate (fails on stale index) + file watcher for local dev + staleness warnings in MCP responses.                  
  - Index size in large repos: Progressive detail levels (L1–L4) limit response payload; per-file JSON keeps merge conflicts scoped. Monitor for repos
   > 10,000 files — may require chunking strategy.                                                                                                    
  - MCP protocol evolution: @modelcontextprotocol/sdk is the reference implementation; Ctxo tracks it as a direct dependency. Breaking changes are  
  upstream-controlled risk.                                                                                                                           
                                                                                                                                                    
  ---                                                                                                                                                 
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Project Type Analysis (Step 7 of 13)                                            
                                                                                                                                    
⏺ Step 7: Project-Type Deep Dive — Developer Tool
                                                                                                                                                      
  From the CSV, developer_tool key questions are: Language support, Package managers, IDE integration, Documentation, Examples. Skipping: visual      
  design, store compliance.                                                                                                                           
                                                                                                                                                      
  Most of this is well-established from the brief and research. Let me fill the gaps with a few targeted questions before drafting:                   
                                                                                                                                                      
  1. Installation method beyond npx ctxo — Is there a planned npm install -g ctxo global install path, or is npx the intentional default              
  (zero-install, always-latest)? This affects how we document installation.                                                                         
                                                                                                                                                      
  2. MCP client configuration — The brief shows the one-line JSON config. Should Ctxo ship a CLI helper (npx ctxo init) that writes the MCP config to 
  the appropriate client config file automatically? Or is manual config acceptable for V1?
                                                                                                                                                      
  3. Documentation strategy — README-first (GitHub), dedicated docs site, or none for V1? For a developer tool targeting Claude Code / Cursor users,  
  the README and MCP server listing are likely the primary discovery surfaces.
                                                                                                                                                      
  4. Code examples — Should the README include worked examples showing a Logic-Slice response for a real TypeScript symbol? This is often the fastest 
  way to communicate value to developers evaluating the tool.
                                                                                                                                                      
  While you think about those, here's the draft requirements section based on what we already know:                                                   
   
  ---                                                                                                                                                 
  Developer Tool Specific Requirements                                                                                                              
                                                                                                                                                      
  Project-Type Overview
                                                                                                                                                      
  Ctxo is an npm package distributed via npx, exposing an MCP server over stdio transport. Its API surface is five MCP tools consumed by AI coding    
  assistants. There is no visual UI; the developer experience is: install (one command), configure (one JSON line), use (via AI assistant). The tool
  must feel invisible — the developer interacts with their AI assistant, not with Ctxo directly.                                                      
                                                                                                                                                    
  Language Matrix

  ┌────────────┬────────────┬────────────────────────────────────┬────────┐
  │  Language  │  Version   │           Analysis Depth           │ Status │
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ TypeScript │ All (3.x+) │ Full type-aware (ts-morph)         │ V1     │
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ JavaScript │ ES2015+    │ Full (ts-morph, no type inference) │ V1     │                                                                           
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ TSX / JSX  │ All        │ Full (tree-sitter TSX grammar)     │ V1     │                                                                           
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ Go         │ All        │ Syntax-level (tree-sitter)         │ V1.5   │                                                                         
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ C#         │ All        │ Syntax-level (tree-sitter)         │ V1.5   │
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ Go (deep)  │ All        │ Type-aware (gopls MCP composition) │ V2     │                                                                         
  ├────────────┼────────────┼────────────────────────────────────┼────────┤                                                                           
  │ C# (deep)  │ All        │ Type-aware (Roslyn LSP)            │ V2     │                                                                         
  └────────────┴────────────┴────────────────────────────────────┴────────┘                                                                           
                                                                                                                                                    
  Installation Methods

  - Primary: npx ctxo index — zero global install, always-latest                                                                                      
  - Global install: npm install -g ctxo — optional, for teams preferring pinned versions
  - MCP client config: Single JSON entry — { "command": "npx", "args": ["-y", "ctxo"] }                                                               
  - CI: npx ctxo index --check in GitHub Actions workflow                                                                                             
                                                                                                                                                      
  API Surface (MCP Tools)                                                                                                                             
                                                                                                                                                      
  ┌───────────────────────────┬──────────────────────┬───────────────────────────────────────┬───────────────┐                                        
  │           Tool            │        Input         │                Output                 │ Detail Levels │
  ├───────────────────────────┼──────────────────────┼───────────────────────────────────────┼───────────────┤                                        
  │ get_logic_slice           │ symbol, file, depth? │ Symbol + transitive deps              │ L1–L4         │                                      
  ├───────────────────────────┼──────────────────────┼───────────────────────────────────────┼───────────────┤
  │ get_blast_radius          │ symbol, file         │ Impact score + affected symbols       │ —             │                                        
  ├───────────────────────────┼──────────────────────┼───────────────────────────────────────┼───────────────┤                                        
  │ get_architectural_overlay │ path?                │ Layer map (Domain/Infra/Adapters)     │ —             │                                        
  ├───────────────────────────┼──────────────────────┼───────────────────────────────────────┼───────────────┤                                        
  │ get_why_context           │ symbol, file         │ Commit intent + anti-pattern warnings │ —             │                                      
  ├───────────────────────────┼──────────────────────┼───────────────────────────────────────┼───────────────┤                                        
  │ get_change_intelligence   │ symbol, file         │ Complexity × churn score              │ —             │                                      
  └───────────────────────────┴──────────────────────┴───────────────────────────────────────┴───────────────┘                                        
                                                                                                                                                    
  All tools return structured JSON. Privacy masking applied to all outputs before MCP response is sent.                                               
                                                                                                                                                    
  Implementation Considerations                                                                                                                       
                                                                                                                                                    
  - Startup: Lazy initialization — MCP server starts in < 100ms; index loaded on first query, not at startup                                          
  - Transport: StdioServerTransport for local subprocess (V1); StreamableHTTP reserved for future cloud tier                                        
  - Index format: Per-file JSON at .ctxo/index/<relative-path>.json; SQLite query cache at .ctxo/cache/ (gitignored)                                  
  - Versioning: Semantic versioning; index format version tracked in .ctxo/index/manifest.json for future migrations                                  
  - Testing: vitest + InMemoryTransport for unit/integration; real filesystem fixtures for E2E                                                        
                                                                                                                                                      
  ---                                                                                                                                                 
  Answer those four questions and I'll lock this in.                                                                                                  
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Scoping (Step 8 of 13)                                                          
                                                                                                                                                      
✻ Churned for 59s               
  ⏺ Step 8: Scoping Exercise   
                                                                                                                                                      
  Reviewing the full PRD so far: vision locked, success criteria defined, four journeys mapped, innovation documented, developer-tool requirements    
  captured. The scope is already well-articulated across V1/V1.5/V2 in both the brief and what we've built. This step is mostly confirming strategic  
  decisions already implicit in the work.                                                                                                             
                                                                                                                                                      
  Here's my read of the current scope posture — tell me where I'm wrong:                                                                              
                                                                                                                                                      
  MVP (V1) is a "Problem-Solving MVP" — the smallest thing that produces a genuine "aha moment" for a solo developer. Five tools, TypeScript only,    
  local-only, npx ctxo. The bet: if Logic-Slicing works as promised, adoption follows organically.                                                  
                                                                                                                                                      
  One scope question I want to stress-test: The V1 feature set includes all five tools plus the privacy masking pipeline, progressive detail levels   
  (L1–L4), monorepo auto-discovery, file watcher, AND CI integration. That's a substantial V1. Would you consider a tighter MVP — say, get_logic_slice
   + get_blast_radius only, ship fast, validate the core bet — before building out the remaining three tools and CI gate?                             
                                                                                                                                                    
  Or is the full five-tool set non-negotiable for V1 because each tool addresses a distinct failure mode and a partial set undersells the product?    
  
  ---                                                                                                                                                 
  Here's the scoping draft assuming full five-tool V1:                                                                                              
                                                                                                                                                      
  ---
  Project Scoping & Phased Development                                                                                                                
                                                                                                                                                    
  MVP Strategy & Philosophy

  MVP Approach: Problem-solving MVP — deliver the core value proposition (Logic-Slice + institutional memory) to individual developers, prove the "aha
   moment," enable organic team adoption via the committed index pattern.
                                                                                                                                                      
  Resource Requirements: 1–2 engineers with TypeScript/AST experience. Solo-buildable by one senior engineer over 6–8 weeks.                          
  
  MVP Feature Set (Phase 1 — V1)                                                                                                                      
                                                                                                                                                    
  Core User Journeys Supported: Journey 1 (Solo Developer), Journey 2 (Team Lead / committed index), Journey 3 (New Joiner), Journey 4 (Stale index   
  recovery).
                                                                                                                                                      
  Must-Have Capabilities:                                                                                                                           
  - get_logic_slice with L1–L4 progressive depth (ts-morph, TypeScript/JavaScript/TSX)
  - get_blast_radius — impact score + affected symbols (SQLite recursive query)                                                                       
  - get_architectural_overlay — layer map (Domain/Infra/Adapters)              
  - get_why_context + anti-pattern memory (git history parsing, revert detection)                                                                     
  - get_change_intelligence — complexity × churn score                                                                                                
  - Privacy masking pipeline (API keys, credentials, private IPs stripped from all outputs)                                                           
  - Committed JSON index (.ctxo/index/) + .gitignore cache separation                                                                                 
  - npx ctxo index + incremental re-indexing + ctxo watch file watcher                                                                                
  - CI indexing gate (GitHub Actions: npx ctxo index --check)                                                                                         
  - Monorepo auto-discovery                                                                                                                           
  - MCP stdio transport, verified: Claude Code, Cursor, VS Code Copilot                                                                               
                                                                                                                                                      
  Post-MVP Features                                                                                                                                   
                                                                                                                                                    
  Phase 2 — V1.5 (Growth):                                                                                                                            
  - Go + C# language support via tree-sitter syntax-level adapters                                                                                  
  - npx ctxo init — auto-writes MCP client config to detected AI assistant config file                                                                
  - Dedicated documentation site (beyond README)                                                                                                    
  - Index health CLI: npx ctxo status                                                                                                                 
                                                                                                                                                      
  Phase 3 — V2+ (Expansion):                                                                                                                          
  - Go deep analysis via gopls MCP composition                                                                                                        
  - C# deep analysis via Roslyn LSP adapter                                                                                                           
  - Multi-repo / cross-service dependency graphs                                                                                                    
  - Natural language query interface over the index                                                                                                   
  - Python support (evaluate based on demand signal post-V1)                                                                                          
  - Optional opt-in analytics: aggregate revert reduction metrics across teams                                                                        
                                                                                                                                                      
  Risk Mitigation Strategy                                                                                                                            
                                                                                                                                                      
  Technical Risks: ts-morph type resolution in large monorepos may exceed memory limits — mitigated by per-file index architecture (never load full   
  program into memory simultaneously) and L1 depth default. Validate on a 5,000-file repo before shipping.                                          
                                                                                                                                                      
  Market Risks: MCP ecosystem may not grow as fast as expected, limiting addressable market — mitigated by ensuring Ctxo works as a standalone CLI    
  tool (not purely MCP-dependent), preserving value even if MCP adoption stalls.
                                                                                                                                                      
  Resource Risks: If solo build, CI gate and monorepo auto-discovery are the highest-effort V1 items — these can ship as V1.1 (day-one post-launch)   
  without breaking the core value proposition.
                                                                                                                                                      
  ---                                                                                                                                                 
  Lock this in, or do you want to tighten the V1 scope?
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Functional Requirements (Step 9 of 13)                                          
                                                                                                                                                      
✻ Crunched for 54s                                                                                                                                  
                                                                                                                                                      
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯                                                                                                                                                     
───────────                                                                                                                                                      
❯ c                                                                                                                                                   
                                                                                                                                                      
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 1 line, removed 1 line                                                                                                                     
      1  ---                                                                                                                                          
      2 -stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-jou       
        -rneys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type']                                                               
      2 +stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-jou       
        +rneys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping']                                                 
      3  inputDocuments:                                                                                                                              
      4    - 'artifacts/planning-artifacts/product-brief-Ctxo.md'                                                                                
      5    - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'
                                                                                                                                                                
⏺ Step 9: Functional Requirements Synthesis
                                                                                                                                                      
  This is the capability contract — everything downstream (architecture, epics, stories) will be built from this list. Let me synthesize across all   
  previous sections.                                                                                                                                  
                                                                                                                                                      
  ---                                                                                                                                                 
  Functional Requirements                                                                                                                             
                                                                                                                                                      
  Index Management                                                                                                                                  

  - FR1: Developer can build a full codebase index from the command line in a single command                                                          
  - FR2: Developer can trigger incremental re-indexing for a single file or directory
  - FR3: Developer can start a file watcher that automatically re-indexes changed files                                                               
  - FR4: Developer can check whether the current index is up to date with source code (for CI use)                                                    
  - FR5: Developer can view a manifest of what is currently indexed (file count, last-updated timestamps)                                             
  - FR6: The system detects index staleness and surfaces an actionable warning in MCP tool responses                                                  
  - FR7: The system auto-discovers monorepo workspaces and indexes all packages                                                                       
                                                                                                                                                      
  Context Delivery (MCP Tools)                                                                                                                        
                                                                                                                                                      
  - FR8: AI assistant can retrieve a Logic-Slice for a named symbol — the symbol plus all transitive dependencies (interfaces, types, helpers) across 
  files                                                                                                                                             
  - FR9: AI assistant can request Logic-Slice at four progressive detail levels (L1 minimal → L4 full) to manage context window size                  
  - FR10: AI assistant can retrieve the blast radius for a symbol — the set of symbols that would break if it changed, ranked by dependency depth     
  - FR11: AI assistant can retrieve an architectural overlay for the codebase — a layer map identifying Domain, Infrastructure, and Adapter boundaries
  - FR12: AI assistant can retrieve the "why context" for a symbol — git commit intent, PR rationale, and anti-pattern warnings from revert history   
  - FR13: AI assistant can retrieve a change intelligence score for a symbol — a composite of cyclomatic complexity and change frequency              
                                                                                                                                                      
  Anti-Pattern Memory                                                                                                                                 
                                                                                                                                                      
  - FR14: The system parses git history to detect revert commits and associates revert rationale with the affected symbols                            
  - FR15: The system surfaces anti-pattern warnings when a symbol with revert history is queried via get_why_context
  - FR16: Anti-pattern warnings persist in the committed index and are available to any developer or AI assistant after git clone                     
                                                                                                                                                      
  Privacy & Security                                                                                                                                  
                                                                                                                                                      
  - FR17: The system strips API keys, credentials, tokens, and private IP addresses from all MCP tool responses before delivery to the AI client      
  - FR18: The privacy masking pipeline is configurable — developers can extend the pattern list for domain-specific sensitive identifiers
  - FR19: The local SQLite query cache is never committed to git (enforced via .gitignore template generated on first run)                            
                                                                                                                                                      
  Team Collaboration & Distribution                                                                                                                   
                                                                                                                                                      
  - FR20: Developer can commit the codebase index to git as text-based, per-file JSON artifacts                                                       
  - FR21: The committed index is diffable in pull requests — changes to indexed symbols are visible as line-level diffs                             
  - FR22: A developer who clones a repository with a committed index gets full context immediately, without running ctxo index                        
  - FR23: The CI system can gate pull requests on index freshness — failing the build when source changes are not reflected in the index              
                                                                                                                                                      
  MCP Client Integration                                                                                                                              
                                                                                                                                                      
  - FR24: Developer can configure any MCP-compatible AI client to use Ctxo with a single JSON configuration entry                                     
  - FR25: Ctxo MCP server starts in the background as a subprocess and is ready to serve queries without manual startup steps
  - FR26: All five MCP tools are callable from Claude Code, Cursor, and VS Code Copilot without client-specific configuration differences             
                                                                                                                                                      
  Language Support                                                                                                                                    
                                                                                                                                                      
  - FR27: Developer can index and query TypeScript, JavaScript, and TSX/JSX codebases with full type-aware dependency resolution (V1)                 
  - FR28: Developer can index and query Go and C# codebases with syntax-level dependency resolution (V1.5)
                                                                                                                                                      
  ---                                                                                                                                               
  Completeness check — capabilities from all prior sections mapped:                                                                                   
                                                                                                                                                      
  ┌──────────────────────────────────────────────────────┬────────────────────────┐
  │                        Source                        │        Covered         │                                                                   
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                 
  │ Logic-Slicing (Journey 1, Executive Summary)         │ FR8, FR9               │
  ├──────────────────────────────────────────────────────┼────────────────────────┤
  │ Blast radius (Journey 3)                             │ FR10                   │                                                                   
  ├──────────────────────────────────────────────────────┼────────────────────────┤
  │ Architectural overlay (Journey 3)                    │ FR11                   │                                                                   
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                 
  │ Why context + anti-pattern memory (Journey 3, Brief) │ FR12, FR14, FR15, FR16 │
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ Change intelligence (Brief, FR-15)                   │ FR13                   │
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ Privacy masking (Brief, Success Criteria)            │ FR17, FR18             │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ Committed index / team asset (Journey 2, Innovation) │ FR20, FR21, FR22       │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ CI gate (Journey 2, Scoping)                         │ FR4, FR23              │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ Stale index recovery (Journey 4)                     │ FR6                    │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ File watcher (Journey 4)                             │ FR3                    │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ MCP client config (Project-Type)                     │ FR24, FR25, FR26       │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ Language matrix (Project-Type)                       │ FR27, FR28             │
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ Index management / monorepo                          │ FR1, FR2, FR5, FR7     │                                                                 
  ├──────────────────────────────────────────────────────┼────────────────────────┤                                                                   
  │ .gitignore cache separation                          │ FR19                   │
  └──────────────────────────────────────────────────────┴────────────────────────┘                                                                   
                                                                                                                                                    
  28 FRs across 7 capability areas. Anything missing?                                                                                                 
  
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Non-Functional Requirements (Step 10 of 13)                                       
                                                                                                                                                    
✻ Baked for 50s                                                                                                                                       
                                                                                                                                                    
❯ devam                                                                                                                                                
                                                                                                                                  
⏺ Step 10: Non-Functional Requirements
                                                                                                                                                      
  Quick relevance assessment for Ctxo:                                                                                                                
                                                                                                                                                      
  - Performance — Critical. Sub-500ms response is a hard product requirement; startup time is a UX constraint. ✅                                     
  - Security/Privacy — Critical. Source code passes through the masking pipeline. ✅                                                                  
  - Reliability — Relevant. Stale index or crashed watcher silently degrades AI quality. ✅                                                           
  - Integration — Relevant. MCP protocol compliance and client compatibility. ✅                                                                      
  - Scalability — Low priority. Single-machine, local tool. No concurrent users, no server load. Skip.                                                
  - Accessibility — Not applicable. CLI tool, no visual UI. Skip.                                                                                     
                                                                                                                                                      
  Here's the draft:                                                                                                                                   
                                                                                                                                                      
  ---                                                                                                                                               
  Non-Functional Requirements

  Performance

  - NFR1: MCP tool responses (all five tools) complete in < 500ms p95 on a warm index for a TypeScript codebase of ≤ 1,000 files                      
  - NFR2: MCP server process starts and is ready to accept connections in < 100ms (measured from process spawn to first tool response readiness)
  - NFR3: Full initial index build completes in ≤ 30s for a 1,000-file codebase on a modern developer machine (MacBook M-series or equivalent)        
  - NFR4: Incremental re-indexing for a single changed file completes in < 2s                                                                         
  - NFR5: Logic-Slice responses at L1 depth are ≤ 150 lines; L4 depth responses stay within a 8,000-token budget to avoid exhausting AI context       
  windows                                                                                                                                             
  - NFR6: Index size for a 1,000-file TypeScript codebase does not exceed 10MB on disk                                                                
                                                                                                                                                      
  Security & Privacy                                                                                                                                
                                                                                                                                                      
  - NFR7: No source code, symbol names, or index content is transmitted to any remote server — all processing is strictly local                       
  - NFR8: The privacy masking pipeline detects and redacts: AWS/GCP/Azure credential patterns, JWT tokens, private IPv4/IPv6 addresses, common .env
  variable patterns (e.g. *_SECRET, *_KEY, *_TOKEN, *_PASSWORD)                                                                                       
  - NFR9: The SQLite query cache (ctxo/cache/) contains no plaintext source code — only derived query results                                       
  - NFR10: Ctxo process runs with no elevated privileges; does not require sudo or admin rights                                                       
                                                                                                                                                      
  Reliability                                                                                                                                         
                                                                                                                                                      
  - NFR11: Index staleness (source file modified after last index build) is detected and reported within the MCP tool response — never silently served
   as fresh
  - NFR12: A crashed or stopped file watcher does not corrupt the committed index; on restart, the watcher re-validates index state before resuming   
  - NFR13: If the SQLite cache is deleted or corrupted, Ctxo rebuilds it from the committed JSON index without user intervention                      
  - NFR14: npx ctxo index --check exits with a non-zero code when any source file has been modified after the index was last built (enabling reliable 
  CI gating)                                                                                                                                          
                                                                                                                                                      
  Integration                                                                                                                                         
                                                                                                                                                    
  - NFR15: Ctxo implements the MCP specification (current stable version at V1 ship date) without extensions or deviations that break compatibility   
  with conformant MCP clients
  - NFR16: All five MCP tools are tested for functional equivalence across Claude Code, Cursor, and VS Code Copilot before V1 release                 
  - NFR17: The MCP server exposes a tools/list response conformant with the MCP spec so AI clients can discover available tools without documentation 
  - NFR18: Ctxo requires only Node.js ≥ 18 and git as runtime dependencies — no additional system installation required                               
                                                                                                                                                      
  ---                                                                                                                                                 
  Anything to adjust?                                                                                                                                 
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Polish Document (Step 11 of 13)                                                 
                                                                                                                                                      
✻ Worked for 49s                 
                                                                                                                                                      
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ devam

⏺ Polish changes made:              
  - Merged "Project Classification" into Executive Summary as a subsection                
  - Consolidated "Product Scope" (brief) and "Project Scoping & Phased Development" (detailed) — removed duplication, kept the clear V1/V1.5/V2 scope 
  overview + renamed detailed section to "Development Roadmap & Risk"                                                                                 
  - Merged Innovation "Risk Mitigation" into the single Roadmap & Risk section                                                                        
  - Renamed "Implementation Considerations" → "Technical Context" (more accurate label)                                                               
  - Tightened Journey 2 prose (removed redundant setup sentence)                                                                                      
  - Removed the Journey Requirements Summary caption header (table is self-explanatory)                                                               
  - Minor anti-pattern cleanup throughout                                                                                                             
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Complete PRD (Step 12 of 13)                                                      
                                                                                                                                                      
✻ Crunched for 3m 37s                                                                                                                               
                                                                                                                                                      
❯ also we need to add unit testing strategy aswell                                                                                                    
⏺ Good catch — let me add a Testing Strategy section. Given the technical context already in the document (vitest, InMemoryTransport, E2E fixtures),  
  this should be concrete.                                                                                                                            
                                                                                                                                                      
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 33 lines                                                                                                               
      357  - **NFR16:** All five MCP tools are tested for functional equivalence across Claude Code, Cursor, and VS Code Copilot before V1 rele       
           ase                                                                                                                                        
      358  - **NFR17:** The MCP server exposes a `tools/list` response conformant with the MCP spec so AI clients can discover available tools 
           without documentation                                                                                                                      
      359  - **NFR18:** Ctxo requires only Node.js ≥ 18 and `git` as runtime dependencies — no additional system installation required              
      360 +                                                                                                                                           
      361 +## Testing Strategy                                                                                                                      
      362 +                                                                                                                                    
      363 +### Unit Tests                                                                                                                      
      364 +                                                                                                                                    
      365 +- **Scope:** Pure domain logic — AST parsing, dependency graph resolution, blast radius calculation, git commit parsing, privacy mas
          +king pattern matching, change intelligence scoring                                                                                  
      366 +- **Approach:** `vitest` with in-memory fixtures; no filesystem or git access. Each module tested in isolation against TypeScript/Ja
          +vaScript AST samples as fixture data.                                                                                               
      367 +- **Coverage target:** ≥ 90% line coverage on core domain modules (`logic-slice`, `blast-radius`, `why-context`, `change-intelligenc
          +e`, `privacy-masker`)                                                                                                               
      368 +- **Key cases:** Circular dependency graphs, symbols with no git history, files with zero revert commits, symbols exceeding L4 depth
          + budget, privacy patterns at token boundaries                                                                                       
      369 +                                                                                                                                    
      370 +### Integration Tests                                                                                                               
      371 +                                                                                                                                    
      372 +- **Scope:** MCP tool handlers end-to-end through the full pipeline — index read → query → privacy masking → MCP response — using `@
          +modelcontextprotocol/sdk` `InMemoryTransport` (no real MCP client required)                                                         
      373 +- **Approach:** Real filesystem fixtures (committed TypeScript sample projects of known structure); SQLite cache rebuilt from fixtur
          +e index on each test run                                                                                                            
      374 +- **Key cases:** All five tools return well-formed MCP responses; stale index warning appears when fixture file is touched after ind
          +ex build; `get_why_context` surfaces revert warning for fixture commits containing "Revert"                                         
      375 +                                                                                                                                    
      376 +### E2E Tests                                                                                                                       
      377 +                                                                                                                                    
      378 +- **Scope:** Full `npx ctxo` CLI — index build, incremental re-index, `--check` exit codes, file watcher trigger                    
      379 +- **Approach:** Real TypeScript fixture projects on disk; CI runs on macOS and Linux (Node.js 18, 20, 22)                           
      380 +- **Key cases:** Index build on clean project produces valid manifest; `--check` exits non-zero after source file modification; incr
          +emental re-index updates only the changed file's JSON; `ctxo watch` detects a save and re-indexes within 2s                         
      381 +                                                                                                                                    
      382 +### MCP Client Compatibility Tests                                                                                                  
      383 +                                                                                                                                    
      384 +- **Scope:** Verify all five tools are callable and return valid responses from Claude Code, Cursor, and VS Code Copilot            
      385 +- **Approach:** Manual smoke test protocol run against a reference TypeScript project before each V1 release; automated where client
          + SDKs expose a testable interface                                                                                                   
      386 +- **Gate:** All three clients must pass smoke tests before V1 release tag is cut (maps to NFR16)                                    
      387 +                                                                                                                                    
      388 +### Privacy Masking Validation                                                                                                      
      389 +                                                                                                                                    
      390 +- **Scope:** Dedicated test fixture set containing known credential patterns (synthetic, non-real) — AWS keys, JWTs, `.env` patterns
          +, private IPs                                                                                                                       
      391 +- **Approach:** Assert zero leakage: run each pattern through all five tool outputs and verify masking pipeline redacts 100% of fixt
          +ure sensitive strings before MCP response                                                                                           
      392 +- **Gate:** Any new credential pattern added to the masking pipeline requires a corresponding fixture test (maps to FR17, FR18, NFR8
          +)                                                                                                                                   

⏺ Testing strategy added with five layers:
                                                                                                                                  
  - Unit — pure domain logic, vitest + in-memory fixtures, ≥ 90% coverage on core modules                                                             
  - Integration — full MCP pipeline via InMemoryTransport, real filesystem fixtures                                                                   
  - E2E — CLI commands on real projects, CI on macOS + Linux across Node 18/20/22                                                                     
  - MCP Client Compatibility — smoke test protocol across Claude Code, Cursor, VS Code Copilot (gated pre-release)                                    
  - Privacy Masking Validation — dedicated synthetic credential fixture set, zero-leakage gate                                                        
                                                                                                                                                      
  Ready to finalize?                                                                                                                                  
                                                                                                                                                      
  Select: [A] Advanced Elicitation  [P] Party Mode  [C] Continue to Complete PRD (Step 12 of 13)                                                      
                                                                                                                                                    
✻ Worked for 33s                                                                                                                                      
                                                                                                                                                    
───  Read 1 file (ctrl+o to expand)                                                                                                                      
                                                                                                                                                      
⏺ Update(artifacts/planning-artifacts/prd.md)                                                                                                      
  ⎿  Added 3 lines, removed 1 line                                                                                                                    
      1  ---                                                                                                                      
      2 -stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-jou       
        -rneys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctiona       
        -l', 'step-11-polish']                                                                                                                        
      2 +stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-jou       
        +rneys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctiona       
        +l', 'step-11-polish', 'step-12-complete']                                                                                                  
      3 +workflowComplete: true                                                                                                                
      4 +completedAt: '2026-03-28'                                                                                                             
      5  inputDocuments:
      6    - 'artifacts/planning-artifacts/product-brief-Ctxo.md'
      7    - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'

⏺ The PRD for Ctxo is complete.          
                                                                                                                                  
  ---
  PRD Summary — artifacts/planning-artifacts/prd.md                                                                                                
                                                                                                                                                      
  ┌─────────────────────────────────────────────────┬────────┐                                                                                        
  │                     Section                     │ Status │                                                                                        
  ├─────────────────────────────────────────────────┼────────┤                                                                                      
  │ Executive Summary + Classification              │ Done   │
  ├─────────────────────────────────────────────────┼────────┤
  │ Success Criteria                                │ Done   │                                                                                        
  ├─────────────────────────────────────────────────┼────────┤
  │ Product Scope (V1 / V1.5 / V2+)                 │ Done   │                                                                                        
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ User Journeys (4 narratives + requirements map) │ Done   │
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ Innovation & Novel Patterns                     │ Done   │                                                                                      
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ Developer Tool Specific Requirements            │ Done   │                                                                                      
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ Development Roadmap & Risk                      │ Done   │                                                                                      
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ Functional Requirements (FR1–FR28)              │ Done   │
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ Non-Functional Requirements (NFR1–NFR18)        │ Done   │                                                                                      
  ├─────────────────────────────────────────────────┼────────┤                                                                                        
  │ Testing Strategy (5 layers)                     │ Done   │
  └─────────────────────────────────────────────────┴────────┘                                                                                        
                                                                                                                                                    
  28 FRs, 18 NFRs, 5 testing layers — fully traced from vision through capability contract.                                                           
                                                                                                                                                    
  ---                                                                                                                                                 
  Next steps — choose your path:                                                                                                                    
                                                                                                                                                      
  [IR] Check Implementation Readiness (/bmad-check-implementation-readiness) — validates PRD completeness before architecture and epic work begins.
  Recommended before the next phase.                                                                                                                  
                                                                                                                                                    
  [CA] Create Architecture (/bmad-agent-architect) — Winston can now work from a full PRD. This was the blocker he identified in the earlier session. 
                                                                                                                                                    
  [CE] Create Epics & Stories (/bmad-create-epics-and-stories) — if you want to go straight to implementation breakdown.                              
                                                                                                                                                    
  The PRD is the foundation — all design, architecture, and development work should trace back to it. Update it as decisions evolve.                  
                                                                                                                                                    
────────