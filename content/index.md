---
title: "Odyssey: Forging Language Agents with Synthesized Environments and Mixed RL at a Humble Scale"
description: "How to make executable environments, build reliable RL infra, and use credit assignment to train language agents, at a budget-constraint scale"
date: 2026-09-24
authors:
  - name: "Shuhan Qin*"
  - name: "Yang Liu*†"
  - name: "Jiaqi Li*"
  - name: "Jun Bai*"
  - name: "Xiaobo Wang*"
  - name: "Tong Wu"
  - name: "Zhe Li"
  - name: "Yanting Wang"
  - name: "Gang Yao"
  - name: "Hao Chen"
  - name: "Zixia Jia"
  - name: "Zilong Zheng✉†"
affiliations:
  - "TongAgents Team, Beijing Institute for General Artificial Intelligence (zlzheng@bigai.ai)"
notes: "*Core Contributors. †Project Lead. ✉Corresponding Author"
bibliography: references.bib
---


## When Your Agent Fails at Step 19

<figure class="l-page">
  <img src="/assets/alphago_lee_sedol.webp" alt="Lee Sedol contemplating during AlphaGo match" />
  <figcaption><strong>Figure 1:</strong> Lee Sedol during the historic AlphaGo vs. Lee Sedol match (2016). AlphaGo's Move 37 in Game 2 became legendary for its unconventional brilliance, a decision that initially appeared to be a mistake but proved pivotal to victory.</figcaption>
</figure>

<div class="evidence-note" style="font-style: italic; margin: 1rem 0 1.5rem;">
Move 37, Step 19: In the second game of <a href="https://en.wikipedia.org/wiki/AlphaGo_versus_Lee_Sedol">AlphaGo vs. Lee Sedol (2016)</a>, AlphaGo played a move so unconventional that commentators initially thought it was a mistake. It became famous as "Move 37", the 37th move of the game, counting both players' moves, but AlphaGo's own 19th move. For AlphaGo, a neural agent, this surprising decision proved brilliant. For a language agent, its own step 19 might instead be a bad tool call that derails an otherwise correct trajectory. The parallel is about assigning credit to individual decisions: can we build systems that learn which actions lead to success and which cause failure?
</div>


Imagine training a language agent to book a flight. The task needs a sequence: search airlines, compare prices, check seats, select options, fill forms, confirm payment. Suppose this workflow takes 19 tool calls. One bad API call at step 19 crashes everything.

With a negative trajectory-level advantage, standard policy gradient methods, such as [REINFORCE with Group Baseline](https://openreview.net/forum?id=r1lgTGL5DE), [GRPO](https://arxiv.org/abs/2402.03300), and [RLOO](https://aclanthology.org/2024.acl-long.662) applies **the same negative advantage to all 19 steps**. The update penalizes tokens from the 18 correct steps alongside those from the failed final call, even though only that last call caused the failure.

This is the credit assignment problem. It gets worse as tasks grow longer.

### What Goes Wrong in Practice

**Scenario 1: The environment lies to you**

```
Agent: get_flight(airline="United", date="2025-01-15")
Environment: ❌ Error: Invalid date format
Reality: The format was correct; the database schema was wrong
RL Update: Penalize the agent for using the correct format
```

**Scenario 2: One typo ruins 18 perfect steps**

```
Step 1-18: ✓ Correct tool calls, valid outputs
Step 19: comfirm_booking()  # typo: should be "confirm"
Standard GRPO: advantage = -1.2 applied to all 19 steps
Result: Update penalizes 18 correct steps along with 1 typo
```

### The Core Bottleneck: Low Learning Value of Experience

Language agents run multi-step workflows where **one error cascades into failure**. The bottleneck has two parts: **Experience Reliability** (noisy environments produce useless rollouts; if ground truth is wrong, the agent can't learn what "correct" means) and **Experience Utilization** (even with reliable environments, coarse episodic rewards hurt optimization: standard [GRPO](https://arxiv.org/abs/2402.03300) applies one advantage per trajectory to every token, penalizing 18 correct steps because of 1 mistake). Training on single environment types produces specialists that fail when distributions shift. Existing work fixes these separately. Odyssey's insight: **you need both, and they must work together**.

Unlike AlphaGo, which mastered a single, well-defined game environment, real-world language agents must operate across diverse and heterogeneous settings: navigating e-commerce platforms, answering research questions, debugging code, managing databases. Each domain brings different tool schemas, reward structures, and failure modes. Generalizing across this variety requires training on a broad spectrum of environments.

### Mixed-Environment RL: Training Across Diverse Environments and Task Distributions

**Mixed-Environment RL** means training policies across multiple, structurally different environments simultaneously: [RuleReasoner](https://openreview.net/forum?id=MQV4TJyqnb), [MiMo-v2.6](https://mimo.xiaomi.com/mimo-v2-6). Unlike domain randomization (varying parameters within one task family), it handles different action spaces (tool schemas vary wildly across domains), reward structures (binary success vs. partial credit), and horizon lengths (search: 3-5 steps; data analysis: 20-40 steps).

Odyssey-13K instantiates Mixed-Environment RL at a moderate scale: 13,000 environments spanning tool use, web search, knowledge work, and conversation, totally 7 macro domains and 27 micro domains. Each training batch samples from this mixture, forcing the policy to:

1. **Generalize tool-calling patterns** across schemas (not memorize one API)
2. **Adapt credit assignment** to varying trajectory lengths and failure modes
3. **Transfer reasoning strategies** between domains (e.g., decomposition learned in research tasks applies to e-commerce)

This is why Odyssey models show transfer to external benchmarks. They've seen structural diversity during training that overlaps with distribution shifts at test time.

## The Odyssey Trilogy: Three Interlocking Components

Odyssey is a closed-loop system where environment quality and training signal improve together:

**Odyssey-Env** mines real-world data (e.g., Wikipedia) to build thousands of verifiable environments. Each environment comes with executable tools, multi-step tasks, and verification code. No human annotation, no trajectory distillation.

**Odyssey-RL** introduces Heuristic Credit Assignment (HCA): detect observable failures (malformed JSON, invalid tool calls, runtime errors), locate the responsible token span, and assign negative gradient only there. Clean trajectories train normally; abnormal trajectories don't contaminate the baseline.

**Odyssey-Infra** enforces training correctness at scale: strict token-in-token-out (TITO) invariance, bitwise parity between training and inference, and elastic scheduling across distributed clusters.

Let's walk through each component, starting with the environments.

## Odyssey-Env: Synthesizing 13,000 Reliable Tasks for Mixed-Env RL

**Garbage in, garbage out**. If your environment returns wrong answers, your agent learns to be confidently wrong. If tools crash randomly, the agent can't tell bad strategy from bad luck.

Odyssey-Env mines real-world structured data and builds 13,000 environments with built-in verification across diverse domains. Training on tool use (database queries), web search (multi-hop retrieval), and knowledge work (data analysis) forces the model to learn generalizable reasoning patterns: decomposition, constraint satisfaction, error recovery that transfer across domains.

### The Odyssey-Env Synthesis Pipeline

<figure class="l-page">
  <img src="/assets/odyssey-env-pipeline.svg" alt="Odyssey-Env Five-Stage Pipeline Visualization" />
  <figcaption><strong>Figure 2:</strong> Five-stage autonomous environment synthesis. Each stage builds on verified outputs from the previous stage.</figcaption>
</figure>

Each environment contains: $q$ (user query), $f_{\text{submit}}$ (submission schema), $\text{solver}$ (ground-truth solution), $\text{verifier}$ (verification program).

**Stage 1: Autonomous Database Seeding**. Generate topic matrix $M$ across domains (travel, e-commerce, research). For each topic $m$, an LLM generates search queries and retrieves structured data into database $D_m$. This is **targeted data mining**: "Find Wikipedia articles about space missions with launch dates" becomes structured tables.

**Stage 2: Executable Tool Synthesis**. Given $D_m$ and topic $m$, generate tools $T_m$ with standardized `list()`/`get()` interfaces, data-logic separation (tools read JSON files, never hard-code data), and automated validation. Every tool is a **pure function over data files**.

**Stage 3: Verifiable Task Builder**. Create multi-step tasks with natural-language query, ground-truth solution (≥2 tool calls), and verification code that independently reconstructs ground truth. The verifier doesn't see the solution, which catches LLM hallucinations.

**Stage 4: Validation Flow**. Execute in isolated sandbox. Failures trigger closed-loop feedback: crashed solution? Regenerate. Failed verifier? Check solvability. This provides self-validation with minimal human supervision.

**Stage 5: Multi-Difficulty Refinement**. Generate harder tasks with multi-condition constraints, cross-file analysis, longer reasoning chains (5+ tool calls).

Result: **Odyssey-13K**, a dataset of 13,000 tasks in 5,000 environments spanning 6 domains, 4 difficulty levels, 8-15 tools per environment.

### Why This Matters: Reliability at Scale

The pipeline produces environments where tasks are executable (validated in sandbox), solutions are verifiable (programmatic ground truth), and no trajectory distillation from teacher models is needed.

This addresses the *experience reliability* bottleneck. But even with reliable environments, coarse credit assignment still wastes learning signal. That's where Odyssey-RL comes in.

### Cost Audit: Economics of Environment Synthesis

To provide transparency on the resource requirements of our synthesis pipeline, we conducted a detailed cost audit of 9 representative tasks from the Odyssey-Env corpus. These tasks span diverse domains, from multilingual content adaptation to smart home planning, and represent the full synthesis workflow: data collection, tool generation, task construction, and iterative verification. Note that we employ the model `dpsk-v4-flash-260425` as environment designer for envs and tasks synthesis.

**Summary Statistics (9 Exemplar Tasks):**

| Metric | Per-Task Average | Total (9 Exemplar Tasks) |
|--------|------------------|-----------------|
| **Wall-clock time** | 67.3 minutes | 10.1 hours |
| **LLM calls** | 130 calls | 1,168 calls |
| **Token consumption** | 1,168,347 tokens | 10.52M tokens |
| **Cost ($)** | 0.88 | 7.90 |
| Input / Output | 766,747 / 401,600 | 6.90M / 3.61M |
| Synthesis / FireCrawl | 978,017 / 190,331 | 8.80M / 1.71M |

**Phase Breakdown (Per-Task Average):**
- Data Collection: 17.0 minutes
- Tool Synthesis: 3.2 minutes  
- Task Construction: 3.8 minutes
- **Verification & Repair: 43.3 minutes (64% of total time)**

**Key Findings:**

1. **Verification is the bottleneck**: 64% of synthesis time is spent in iterative solution-verification loops. Of the 9 tasks analyzed, only 2 passed verification on the first attempt. The remaining 7 required multiple repair cycles, with some tasks taking 15-20 verification rounds before converging to a valid solution-test pair.

2. **Token distribution skews heavily toward synthesis**: 84% of tokens are consumed during the synthesis stages (tool generation, task construction, verification), while FireCrawl-based data extraction accounts for 16% (avg. 43 API calls per task, ~17 minutes).

3. **High variance in resource consumption**: Wall-clock time ranged from 48 to 90 minutes, and token usage varied between 750K and 1.54M per task. This variance is driven primarily by the number of verification repair cycles. Tasks with complex constraint interactions or edge cases require more iteration.

4. **ROI and cost-effectiveness**: At 0.88 dollar per task, synthesizing 13,000 environments cost approximately 11,440 dollar. This is 2-3 orders of magnitude cheaper than hiring human annotators to design, implement, and validate equivalent environments. Each synthesized task generates hundreds of training rollouts, amortizing the upfront cost across thousands of gradient steps.

**Detailed Task Breakdown:**

| Task | Status | Time | LLM Calls | Token Cost | LLM Time % |
|------|--------|------|-----------|------------|-----------|
| adapt-multilingual-apology | Verification retry | 90m | 133 | 1,423,881 | 90% |
| design-digital-estate-plan | ✅ Verified | 59m | 104 | 1,023,090 | 93% |
| extract-phrases-reviews | Verification retry | 53m | 117 | 748,468 | 89% |
| phase-smart-home-upgrades | Verification retry | 69m | 130 | 1,282,846 | 92% |
| aggregate-learning-progress | ✅ Verified | 70m | 136 | 1,203,522 | 92% |
| create-rule-based-system | Verification retry | 80m | 150 | 1,541,059 | 89% |
| outline-cultural-observation | Verification retry | 65m | 140 | 1,169,940 | 92% |
| align-couriers-route | Verification retry | 73m | 138 | 1,262,363 | 94% |
| create-ikea-assembly-workflow | Verification retry | 48m | 120 | 859,956 | 87% |

**Implications for future work**: The most direct path to cost reduction is improving verification convergence. Current repair strategies use LLM-in-the-loop debugging, which scales poorly with constraint complexity. Techniques like formal verification, symbolic execution, or learned repair models could reduce the verification phase from 43 minutes to under 10 minutes per task, cutting total synthesis cost by ~50%. Additionally, caching intermediate artifacts (tool schemas, test templates) across similar tasks could reduce redundant LLM calls.

This cost audit demonstrates that **automated environment synthesis is economically viable at scale**, even with current inefficiencies. The per-task cost of 0.88 dollar is negligible compared to the downstream training value, and further optimization can drive this cost below 0.50 dollar per task.

## Odyssey-RL: Agentic RL via Heuristic Credit Assignment

### Why Heuristic Credit Assignment?

When models generate chain-of-thought reasoning or execute tool-calling sequences, they shift from **[latent reasoning](https://arxiv.org/abs/2505.13308)** (internal, opaque computation) to **observable execution traces** (structured tool calls, API responses). This observability creates an opportunity for [AI4AI](https://xyz-lab.ai/blogs/ai4ai-at-scale/assets/bounded-exploration-ai4ai-system-optimization.pdf): detect problems in the reasoning chain via **[CoT Monitoring](https://web.stanford.edu/~cgpotts/blog/cot)**, flag violated constraints, and trace errors to their source.

The insight: **We don't need to tell the agent how to succeed. We need to tell it what not to do.** Principled errors (malformed JSON, invalid tool schemas, protocol violations) should carry immediate, local penalties. This shifts learning from "here's the right trajectory" (expensive, needs expert demonstrations) to "here's what breaks" (cheap, automated via static analysis). Heuristic Credit Assignment operationalizes this: detect observable failures, assign blame only to the tokens that caused them.

Standard GRPO is credit-blind. For a group of $G$ trajectories sampled per question $x$, the advantage of trajectory $i$ is:

$$
\hat{A}_i = \frac{\widetilde{R}_i - \mu_x}{\sigma_x + \varepsilon}
$$

where $\mu_x$ and $\sigma_x$ are the mean and standard deviation of returns in the group. The policy gradient then updates **all tokens** in trajectory $i$ with the same advantage $\hat{A}_i$.

This is coarse credit assignment: every action in a failed trajectory gets equal blame, even if only one malformed tool call caused the failure.

### The HCA Insight: Localize Blame to Observable Errors

**Heuristic Credit Assignment (HCA)** introduces three mechanisms:

1. **Failure Detection**: Identify observable errors in rollouts
2. **Localized Credit Mask**: Restrict gradient to responsible token spans
3. **Clean Group Baseline**: Prevent abnormal trajectories from polluting advantages

Let's walk through each.

#### 1. Failure Detection


During rollout, flag trajectories as **abnormal** if they show any of these failures:

| **Failure Type** | **Detection Rule** | **Example** |
|--------------|----------------|---------|
| **Malformed JSON** | Parse error in tool call | `{"query": "Nolan"` (missing closing brace) |
| **Invalid tool call** | Function not in schema | `get_moive()` (typo: should be `get_movie`) |
| **Wrong argument** | Type mismatch or missing field | `list_movies(director=2010)` (year as director) |
| **Runtime error** | Exception during execution | KeyError, IndexError, timeout |
| **Budget exhausted** | Hitting turn or token limit | 64 tool calls without solution |

<div class="table-caption"><strong>Table 1:</strong> Heuristic failure detection rules. Five categories of observable failures that HCA uses to localize credit assignment.</div>

A trajectory is **abnormal** if $e_t \neq \varnothing$ for some turn $t$. Define the **responsible step** as:

$$
t^* = \min\{t : e_t \neq \varnothing\}
$$

An abnormal trajectory ends at $t^*$ with training return $\widetilde{R}_i = 0$. Normal trajectories use the actual reward: $\widetilde{R}_i = R(\tau_i)$.

#### 2. Localized Credit Mask

Let $b_{t,j}^i \in \{0,1\}$ denote the original response-loss mask (which tokens are eligible for gradient). 

**For normal trajectories**: $m_{t,j}^i = b_{t,j}^i$ (unchanged)

**For abnormal trajectories**: Restrict to error span $C_i$ in the first lagged turn $t_i^*$:

$$
m_{t,j}^i = b_{t,j}^i \cdot \mathbb{1}[t = t_i^*] \cdot \mathbb{1}[j \in C_i]
$$

The error span $C_i$ is the token range containing the malformed tool call or JSON. For example:

```
Turn 3 (normal): get_movie("tt0468569")  ✓ All tokens masked
Turn 4 (error):  get_moive("tt0137523")  ✗ Only "moive" gets gradient
Turn 5 (unreached): ...                  ✗ Zero mask
```

Thus $m_{t,j}^i \leq b_{t,j}^i$: **HCA only removes gradient-eligible tokens**. It assigns negative signal to the error span, not the entire trajectory.

#### 3. Clean Group Baseline

Let $\mathcal{C}_x$ denote indices of clean (non-abnormal) trajectories. Define baseline set:

$$
\mathcal{B}_x = \begin{cases}
\mathcal{C}_x & \text{if } |\mathcal{C}_x| \geq 1 \\
\{1, \ldots, G\} & \text{otherwise}
\end{cases}
$$

Compute group mean $\mu_x$ and standard deviation $\sigma_x$ over $\mathcal{B}_x$ only.

**Key property**: When at least one clean trajectory exists, abnormal trajectories don't contaminate the baseline. If $\mu_x > 0$, every abnormal trajectory gets the same negative advantage:

$$
\hat{A}_i^{\mathrm{HCA}} = -\frac{\mu_x}{\sigma_x + \varepsilon} < 0
$$

regardless of how many other abnormal trajectories exist.


### The HCA Objective

Let $N_i = \sum_{t,j} m_{t,j}^i$ be the masked token count. The surrogate objective is:

$$
\mathcal{J}_{\mathrm{HCA}}(\pi_\theta) = \mathbb{E}_{x \sim \mathcal{D}, \{\tau_i\}_{i=1}^G \sim \pi_\theta(\cdot|x)} \left[ \frac{1}{G} \sum_{i=1}^{G} \frac{1}{\textcolor{red}{\max(1, N_i)}} \sum_{t,j} \textcolor{red}{m_{t,j}^i} \log \pi_\theta(a_{t,j}^i \mid h_t^i, a_{t,\text{<}j}^i) \widehat{A}_i^{\mathrm{HCA}} \right]
$$

**Literally, It means**: 

- Sample $G$ trajectories per question
- If a trajectory is normal: update all its tokens with standard group-relative advantage
- If a trajectory is abnormal: update only the error span with negative advantage computed from clean baseline

When no trajectory is abnormal, $m^i = b^i$ and $\mathcal{B}_x = \{1, \ldots, G\}$, **recovering standard baseline estimation**. HCA is a conservative extension.

### Why This Works: Preserving Signal, Blocking Noise

HCA reduces to standard group-baseline estimation when no failures occur, while:

- **Preventing abnormal trajectories from diluting baselines**: If 7 out of 8 rollouts crash at step 2, the baseline is computed from the 1 clean trajectory, not the mean of all 8
- **Penalizing only responsible tokens**: A typo at step 4 doesn't penalize correct reasoning at steps 1-3
- **Maintaining stable gradient variance**: Localized masks reduce the effective token count, preventing gradient explosion from long failed rollouts

The result: **sample efficiency improves** on long-horizon tasks compared to standard GRPO, with gains of 0.1-0.3× observed in our experiments.

## Odyssey-Infra: Towards a Correct and Stable Agentic RL System

Odyssey extends [Slime](https://github.com/THUDM/slime) to serve as the RL training infrastructure. We developed Odyssey agent harness based on [R2E-Gym](https://github.com/R2E-Gym/R2E-Gym) but with a simpler architecture and can be deemed as a basic ReAct runtime. The system enforces training correctness and stability through three key mechanisms:

<figure class="l-page">
  <img src="/assets/odyssey_infra.svg" alt="Odyssey-Infra Architecture" />
  <figcaption><strong>Figure 3:</strong> Odyssey-Infra architecture for reliable agentic RL training at scale. The system coordinates rollout workers (SGLang inference servers) and training workers (Megatron-LM) through a central coordinator, enforcing three key guarantees: <strong>(1) Strict Token-In-Token-Out (TITO)</strong> passes tokens directly from generation to training without re-encoding, eliminating tokenization inconsistencies; <strong>(2) Bitwise Parity</strong> achieves zero training-inference mismatch through deterministic execution, batch-invariant kernels, and matched tensor layouts; <strong>(3) Elastic Scheduling</strong> manages distributed GPU resources with cache-aware worker reuse and coordinated rollout cancellation to prevent stale gradients. This infrastructure enables stable, large-scale training while maintaining correctness guarantees absent in standard RL setups.</figcaption>
</figure>

### 1. Strict Token-In-Token-Out (TITO)

**The Problem**: Agent loops convert between tokens and strings. In practice, this conversion is not always faithful. Decoding a token sequence into text and re-encoding it can change the sequence, particularly for text containing abbreviations. For instance, the token for "alternatively" can split into three tokens after a decode-encode round trip. This creates inconsistency between rollout-side and training-side token sequences.

**The Solution**: To avoid unexpected multi-segment forking for each rollout caused by re-encoding, Odyssey enforces strict TITO following [Dressage](https://github.com/Accio-Lab/Dressage). Response tokens generated by SGLang are passed **directly** to the Megatron training engine as token sequences. Decoding is performed only for display or logging, never in the critical path.

### 2. Faster True On-Policy RL with Bitwise Parity

<figure class="l-page">
  <img src="/assets/bitwise_parity_trace.svg" alt="Bitwise Parity Verification Process" />
  <figcaption><strong>Figure 4:</strong> Walking backward from the selected-token log probability to the first numerical difference. Trainer scoring, inference prefill and inference decode begin with the same inputs and weights. Their selected-token log probability bytes are compared, the forwards are traced backward to the first differing operation, and that operation is reduced to one row, reduction or state update. Its inputs, constants, rounding points, complete addition order and state handoffs are aligned. Scheduling, layout and transport may change only after the production-shape byte comparison passes again. See details from the source of this illustration: kiddyboots216.github.io/mismatch.</figcaption>
</figure>

**Faster-TOP (Faster True On-Policy)** implements zero training-inference mismatch with optimized kernels:

**Level 1: Deterministic Execution**: deterministic attention and communication on both rollout and training paths.

**Level 2: Batch-Invariant Kernels**: borrowed from [He et al. 2025](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference), prevents numerical results from changing with batch composition.

**Level 3: Bitwise Parity**: matches tensor parallel layout, precision, operator ordering across training and inference. Uses profiling to find divergence. **Result**: exact agreement between trainer and rollouter log probabilities.

### 3. Efficient Threading and Elastic Scheduling

Similar to [Mercor and Sky Lab](https://www.mercor.com/blog/training-frontier-knowledge-work-agents-a-397b-rl-training-guide-with-skyrl), Odyssey coordinates separate concurrency budgets, cache-aware MCP worker reuse, and coordinated rollout cancellation to prevent stale requests from corrupting later rollouts.

## Benchmarking Odyssey Agents

We evaluate Odyssey models on six benchmarks: [BFCL-v4](https://github.com/shishirpatil/gorilla) and [ACEBench](https://github.com/chenchen0103/ACEBench) (tool use), [τ²-Bench](https://github.com/sierra-research/tau2-bench) and [VitaBench](https://github.com/meituan-longcat/vitabench) (conversation), [WorkBench](https://github.com/olly-styles/WorkBench) and [OfficeQA](https://www.databricks.com/blog/introducing-officeqa-benchmark-end-to-end-grounded-reasoning) (knowledge work).

| Method | BFCL-v4 | ACEBench | τ²-Bench | VitaBench | WorkBench | OfficeQA | Avg. |
|---|---|---|---|---|---|---|---|
| **Base Agents** | | | | | | | |
| [ReAct](https://openreview.net/forum?id=WE_vluYUL-X) ([Qwen3-4B](https://arxiv.org/abs/2505.09388v1)) | 35.2 | 51.6 | 25.9 | 2.0 | 45.6 | 17.5 | 29.6 |
| [ReAct](https://openreview.net/forum?id=WE_vluYUL-X) ([Qwen3-8B](https://arxiv.org/abs/2505.09388v1)) | 36.3 | 59.1 | 37.7 | 1.0 | 57.0 | 20.6 | 35.2 |
| [ReAct](https://openreview.net/forum?id=WE_vluYUL-X) ([Qwen3-14B](https://arxiv.org/abs/2505.09388v1)) | 39.1 | 69.0 | 40.1 | **9.0** | 59.2 | 24.4 | 40.1 |
| **Proprietary Agents** | | | | | | | |
| [GPT-4.1-mini](https://openai.com/index/gpt-4-1) | 35.0 | 67.5 | *48.3* | 7.0 | 38.4 | 7.5 | 33.9 |
| [Gemini 2.5 Flash](https://arxiv.org/abs/2507.06261) | 19.6 | 72.5 | 40.5 | 5.0 | 51.4 | 15.8 | 34.1 |
| [Claude Haiku-4.5](https://www.anthropic.com/news/claude-haiku-4-5) | **52.8** | *75.8* | **54.2** | 5.0 | **74.9** | **28.5** | **48.5** |
| **Environment Scaling** | | | | | | | |
| [Toucan-7B](https://arxiv.org/abs/2510.01179) † | 17.8 | N/A | 17.7 | 3.0 | N/A | N/A | N/A |
| [AWM-8B](https://openreview.net/forum?id=OvLnVkV14P) † | 45.0 | N/A | 34.4 | 5.8 | N/A | N/A | N/A |
| [ScaleEnv-8B](https://openreview.net/forum?id=4GX4r1CYtD) † | N/A | N/A | 38.5 | N/A | N/A | N/A | N/A |
| [EnvScaler-8B](https://aclanthology.org/2026.findings-acl.407) † | 41.9 | *72.5* | N/A | 6.7 | N/A | N/A | N/A |
| [SPADE-8B](https://arxiv.org/abs/2608.19197) † | 41.8 | 69.0 | 29.5 | N/A | N/A | N/A | N/A |
| **Odyssey (Ours)** | | | | | | | |
| Odyssey-Nano (4B) | 39.7 (+4.5) | 65.0 (+13.4) | 33.4 (+7.5) | 3.1 (+1.1) | 46.5 (+0.9) | 18.3 (+0.8) | 34.3 (+4.7) |
| Odyssey-Mini (8B) | 47.7 (+11.4) | 68.3 (+9.2) | 45.6 (+7.9) | *8.0* (+7.0) | 58.0 (+1.0) | 20.6 (+0.0) | 41.3 (+6.1) |
| Odyssey-Mid (14B) | *49.5* (+10.4) | **78.3** (+9.3) | 37.9 <span style="color: #d32f2f;">(−2.2)</span> | 6.0 <span style="color: #d32f2f;">(−3.0)</span> | *61.0* (+1.8) | *26.7* (+2.3) | *43.2* (+3.1) |

<div class="table-caption"><strong>Table 2:</strong> Benchmarking results across six held-out agentic benchmarks. Odyssey shows consistent improvements over base models, with the 8B variant achieving +6.1% avg. gain and improvements in tool use and conversation tasks. Note: <b>Bold</b>: best result, <i>Italic</i>: second-best. "†": scores reported from original work. "N/A": scores not available. Numbers in parentheses show improvement over corresponding base agent.</div>

**Held-out Benchmark Categories**: BFCL-v4 and ACEBench (tool use), τ²-Bench and VitaBench (conversation), WorkBench and OfficeQA (knowledge work).

Odyssey improves over base models across most benchmarks. The 8B model achieves +6.1% average gain, with strong improvements in tool use (+11.4 on BFCL-v4) and conversation (+7.9 on τ²-Bench, +7.0 on VitaBench). The 14B model reaches 43.2% overall.

### Generalization to External Benchmarks

Models trained on Odyssey-13K generalize to external benchmarks without fine-tuning.

#### WikiQA: Single-Hop and Multi-Hop Question Answering

| **Task Type** | **Benchmark** | **Odyssey-8B (Qwen3-8B)** | **Odyssey-14B (Qwen3-14B)** |
|-----------|-----------|----------------------|-------------------------|
| **Single-Hop** | [Natural Questions](https://aclanthology.org/Q19-1026) | 80.4 | 80.0 |
| | [TriviaQA](https://arxiv.org/abs/1705.03551) | **91.4** | **93.3** |
| | [PopQA](https://aclanthology.org/2023.acl-long.546) | **60.1** | **60.8** |
| **Multi-Hop** | [HotpotQA](https://aclanthology.org/D18-1259) | **75.1** | **80.1** |
| | [2WikiMultiHopQA](https://aclanthology.org/2020.coling-main.580) | **82.6** | 80.5 |
| | [Musique](https://aclanthology.org/2022.tacl-1.31) | 40.6 | 41.4 |
| | [Bamboogle](https://aclanthology.org/2023.findings-emnlp.378) | 82.4 | **88.0** |
| **Average** | | **71.9** | **73.0** |

<figure class="l-page">
  <img src="/images/wikiqa_react_vs_odyssey.svg" alt="WikiQA average Pass@1: ReAct versus Odyssey at 4B, 60.8 versus 69.4; 8B, 66.0 versus 71.9; 14B, 66.0 versus 73.0." loading="lazy">
  <figcaption><strong>Figure 5:</strong> Average WikiQA Pass@1 for ReAct and Odyssey at matching model sizes. Values are taken from the existing WikiQA comparison figure; no run-level uncertainty is available for these comparisons.</figcaption>
</figure>

Odyssey improves over ReAct at all three sizes: 60.8→69.4 at 4B (+8.6), 66.0→71.9 at 8B (+5.9), 66.0→73.0 at 14B (+7.0). Odyssey-Nano (4B) exceeds ReAct 8B and 14B by 3.4 points. Individual benchmarks don't improve uniformly; 14B scores slightly lower than 8B on Natural Questions and 2WikiMultiHopQA. These averages show an advantage over reported baselines but don't isolate which training components produced gains or establish statistical significance.

#### Deep Search: GAIA, BrowseComp-Plus, xbench-DeepSearch

On challenging deep search benchmarks that require extended search, analysis, and synthesis:

<figure class="l-page">
  <img src="/assets/odyssey_websearch_dynamics.svg" alt="Web Search Dynamics Analysis" />
  <figcaption><strong>Figure 6:</strong> Long-horizon search behavior on BrowseComp-Plus. We compare Odyssey-Mid against ReAct (Qwen3-14B), filtering out questions that ReAct already solved correctly. For the remaining challenging questions, we group them by the increase in web search calls that Odyssey makes relative to ReAct, then measure the number of questions solved in each bucket. The curve shows an initial rise followed by a decline, indicating that the model learns to adopt long-horizon search strategies after training. The ascending portion demonstrates that extended search helps solve difficult problems within a certain range, while the subsequent decline reflects questions that remain challenging even with more search attempts. This decline does not invalidate the long-horizon approach; rather, it suggests that for the hardest questions, the model attempts more searches as a natural exploration strategy, even when the underlying problem complexity exceeds the model's current reasoning capacity.</figcaption>
</figure>

| **Benchmark** | **Domain** | **Odyssey-8B** | **Odyssey-14B** | **Odyssey-14B + Summarization** |
|-----------|--------|------------|-------------|----------------------|
| **[BrowseComp-Plus](https://aclanthology.org/2026.acl-long.1023)** | Document Navigation | 18.3 <span style="color: #16a34a; font-weight: 500;">(+0.8)</span> | 27.3 <span style="color: #16a34a; font-weight: 500;">(+13.2)</span> | **27.8 <span style="color: #16a34a; font-weight: 500;">(+13.7)</span>**  |
| **[GAIA](https://proceedings.iclr.cc/paper_files/paper/2024/hash/25ae35b5b1738d80f1f03a8713e405ec-Abstract-Conference.html)** | General Search | **36.9 <span style="color: #16a34a; font-weight: 500;">(+6.8)</span>** | **42.7 <span style="color: #16a34a; font-weight: 500;">(+15.5)</span>** | **44.7 <span style="color: #16a34a; font-weight: 500;">(+17.5)</span>** |
| **[xbench-DeepSearch](https://xbench.org/agi/aisearch)** | Deep Search | **25.0 <span style="color: #dc2626; font-weight: 500;">(-2.0)</span>** | **44.0 <span style="color: #16a34a; font-weight: 500;">(+20.0)</span>** | **51.0 <span style="color: #16a34a; font-weight: 500;">(+27.0)</span>** |

Compared to the associated base models as start points, Odyssey-14B matches or exceeds specialized 8B agents ([ASearcher-32B](https://github.com/inclusionAI/ASearcher): 28.9% BrowseComp-Plus, 58.7% GAIA; [CutBill-8B](https://agate-slipper-ef0.notion.site/Cut-the-Bill-Keep-the-Turns-Affordable-Multi-Turn-Search-RL-003f78214a4d451fb06f453d084e666c): 35.1%, 45.6%), despite being a general-purpose model trained on mixed environments.

#### Tool Usage: BFCL-v4 and ACEBench

<figure class="l-page">
  <img src="/images/tool_usage_react_vs_odyssey.svg" alt="Tool usage Pass@1, ReAct versus Odyssey at 4B, 8B, and 14B: BFCL-v4 35.2 to 39.7, 36.3 to 47.7, 39.1 to 49.5; ACEBench 51.6 to 65.0, 59.1 to 68.3, 69.0 to 78.3." loading="lazy">
  <figcaption><strong>Figure 7:</strong> ReAct base agents (light bars) and Odyssey agents (dark bars) on BFCL-v4 and ACEBench. Odyssey has higher mean Pass@1 in all six comparisons. Gains range from 4.5 to 11.4 points on BFCL-v4 and 9.2 to 13.4 points on ACEBench.</figcaption>
</figure>

BFCL-v4 scores: 35.2→39.7 (4B), 36.3→47.7 (8B), 39.1→49.5 (14B). ACEBench: 51.6→65.0, 59.1→68.3, 69.0→78.3. Odyssey-Mini (8B) shows the largest BFCL-v4 gain (+11.4); Odyssey-Nano (4B) the largest ACEBench gain (+13.4). Odyssey-Nano (4B) slightly exceeds ReAct-14B on BFCL-v4 (39.7 vs. 39.1) but remains below on ACEBench (65.0 vs. 69.0).

#### Conversation: τ²-Bench and VitaBench

<figure class="l-page">
  <img src="/images/conversation_react_vs_odyssey.svg" alt="Conversation scores, ReAct versus Odyssey: τ²-Bench 25.9 to 33.4, 37.7 to 45.6, 40.1 to 37.9; VitaBench 2.0 to 3.1, 1.0 to 8.0, 9.0 to 6.0 at 4B, 8B, and 14B." loading="lazy">
  <figcaption><strong>Figure 8:</strong> Conversation Pass@1 across model sizes. Odyssey improves both benchmarks at 4B and 8B, but scores below its corresponding base at 14B.</figcaption>
</figure>

**Key Observations**:

- **Gains at 4B and 8B**: τ²-Bench improves by 7.5 and 7.9 points; VitaBench by 1.1 and 7.0 points.
- **Declines at 14B**: τ²-Bench drops 2.2 points (40.1→37.9); VitaBench drops 3.0 points (9.0→6.0).

#### Knowledge Work: WorkBench and OfficeQA

<figure class="l-page">
  <img src="/images/knowledge_work_react_vs_odyssey.svg" alt="Knowledge work scores, ReAct versus Odyssey: WorkBench 45.6 to 46.5, 57.0 to 58.0, 59.2 to 61.0; OfficeQA 17.5 to 18.3, 20.6 to 20.6, 24.4 to 26.7 at 4B, 8B, and 14B." loading="lazy">
  <figcaption><strong>Figure 9:</strong> Knowledge Work Pass@1. Five of six comparisons improve; OfficeQA at 8B is unchanged.</figcaption>
</figure>

WorkBench gains: 0.9 (4B), 1.0 (8B), 1.8 (14B). OfficeQA: +0.8 (4B), 0.0 (8B), +2.3 (14B). Gains are smaller than on tool-use benchmarks.

Training on mixed environments teaches invariant structures: decompose queries into sub-goals, recover from tool errors, verify partial progress. These patterns transfer when tools, schemas, and rewards change.


### Training Dynamics: Learning Behavior Over Time

The following curves summarize reward, completion, interaction length, search activity, and action validity for Odyssey-8B and Odyssey-14B. Logging ranges differ across metrics.

<div class="training-charts-grid" style="margin: 3rem 0;">
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr)); gap: 1.5rem;">
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-reward"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-env-done"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-response"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-steps"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-search"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-unknown"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-grad-norm"></canvas>
    </div>
    <div style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); padding: 2rem 1.75rem; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.04);">
      <canvas id="chart-policy-entropy"></canvas>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.1/dist/chart.umd.min.js"></script>
<script src="/assets/training-charts.js"></script>


**Key observations** (late-training values average the last 20 logged points):

- **Reward improves, but completion ≠ correctness.** Reward rises from 0.14 to 0.38 (8B) and 0.22 to 0.39 (14B). Late-training completion rates are higher (0.91 and 0.83), but reaching environment termination doesn't guarantee task success.
- **Trajectories lengthen.** Average steps rise from 4.1 to 8.8 (8B) and 4.3 to 14.1 (14B). More interaction doesn't necessarily mean better reasoning.
- **Malformed-action rates decline.** Falls from 37.5% to 1.25% (8B) and 21.1% to 0.02% (14B). This supports improved action validity; attributing it specifically to HCA requires ablation.

### Training-Inference Consistency: Logprob Stability

A critical aspect of reliable RL training is maintaining consistency between the training trajectory log probabilities and those computed during rollout. The **rollout logprob absolute difference** measures this divergence: when training and rollout produce significantly different log probabilities for the same tokens, it signals potential issues such as stale gradients, numerical instability, or train-inference mismatch.

<figure class="l-page">
  <img src="/assets/training_logprob_consistency.svg" alt="Training Rollout Logprob Consistency" />
  <figcaption><strong>Figure 10:</strong> Training-rollout log probability absolute difference over 199 training steps (Odyssey-14B). The orange curve (w/o Faster-TOP) shows natural convergence from 0.0117 to 0.0091 due to training dynamics. The green dashed line represents perfect consistency (0.0) achieved with Odyssey-Infra's Faster-TOP optimization, which enforces bitwise parity through TITO and deterministic execution mechanisms. Lower values indicate better consistency between training and inference computations.</figcaption>
</figure>

**Key observations**:

- **Natural convergence without Faster-TOP**: The orange curve shows the logprob difference decreases naturally from 0.0117 to 0.0091 over the training run, a natural 22.6% improvement driven by training dynamics. This intuitively suggests that partial rounding errors diminish as training progresses; however, the underlying mechanisms behind this trend warrant further investigation and ablation.

- **Faster-TOP target consistency**: The green dashed line at 0.0 represents the perfect consistency achievable with Odyssey-Infra's Faster-TOP optimization. Faster-TOP enforces bitwise parity between training and inference through strict TITO token passing and deterministic kernel execution. The gap between the orange curve and the green line illustrates the remaining consistency overhead that Faster-TOP eliminates. In contrast, systems with re-tokenization or non-deterministic floating-point operations can exhibit logprob drifts of 0.05 or higher.

- **Impact on credit assignment**: Even the naturally improving consistency (orange curve) ensures that advantage estimates computed during rollout reasonably reflect the policy's behavior during training. When rollout logprobs drift significantly from training logprobs, the policy gradient estimator becomes biased, leading to noisy updates. The observed stability supports HCA's ability to localize credit, as the underlying probability computations remain coherent across training and rollout phases. Faster-TOP would push this to perfect coherence.

- **No catastrophic divergence**: The metric exhibits natural variance (peak at 0.013, trough at 0.0085) but never undergoes sudden spikes or divergence, which would indicate gradient staleness or numerical overflow. This stability allows Odyssey to safely train for extended horizons without encountering the train-inference mismatch issues that plague many RL systems at scale.

This metric complements the reward and completion curves: while those measure task-level outcomes, logprob consistency measures the **infrastructure-level reliability** that enables those outcomes.

### Findings & Insights

Environment quality and algorithm design must work together. Clean environments allow vanilla policy gradient with group baseline methods like GRPO to work; noisy environments need specialized methods. Odyssey uses three mechanisms:

1. **Heuristic Credit Assignment**: Localizes gradient updates to token spans responsible for observable failures, preventing a single mistake from contaminating gradients for correct reasoning.

2. **Task-Family Balance**: Maintains proportional sampling across domains. Without balancing, high-reward tasks dominate and the policy overfits.

3. **Online Biased Task Optimization**: Upweights tasks where the policy shows improvement variance, focusing compute on the learning frontier.

The key lesson: HCA exists because Odyssey-Env generates diverse structures where coarse credit fails. Odyssey-Env's validation exists because HCA requires observable failure signals. They must co-evolve.

## Qualitative Analyses of Traces

To complement the quantitative benchmarks, we provide interactive trace visualizations that reveal how Odyssey agents reason, search, and recover from errors. Each trace shows the complete conversation flow: system prompts, user questions, assistant reasoning (thinking), tool calls, and observations.

<link rel="stylesheet" href="/assets/trace-viewer.css">

<div id="trace-viewer-container"></div>

<style>
:root {
  --gh-canvas-default: #ffffff;
  --gh-canvas-subtle: #f6f8fa;
  --gh-canvas-inset: #f6f8fa;
  --gh-border-default: #d0d7de;
  --gh-border-muted: #d8dee4;
  --gh-fg-default: #1f2328;
  --gh-fg-muted: #656d76;
  --gh-fg-subtle: #6e7781;
  --gh-accent-fg: #0969da;
  --gh-accent-emphasis: #0969da;
  --gh-danger-fg: #d1242f;
  --gh-danger-emphasis: #cf222e;
  --gh-success-fg: #1a7f37;
  --gh-success-emphasis: #1f883d;
  --gh-attention-fg: #9a6700;
  --gh-attention-emphasis: #bf8700;
  
  /* Custom highlight colors */
  --trace-blue-light: #bad2f3;
  --trace-blue: #2c79d6;
  --trace-red-light: #f9ccbc;
  --trace-red: #eb6935;
  --trace-green-light: #bfe3b4;
  --trace-green: #3b8e2c;
  --trace-purple: #8250df;
  --trace-orange: #d97917;
}

#trace-viewer-container {
  margin: 2rem 0;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.terminal-window {
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 
              0 8px 32px rgba(0, 0, 0, 0.12),
              0 0 0 0.5px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  max-width: 100%;
  margin: 0 auto;
  border: 1px solid #e1e4e8;
}

.terminal-header {
  background: linear-gradient(180deg, #f5f5f5 0%, #ececec 100%);
  padding: 11px 14px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #d1d5da;
  user-select: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.terminal-buttons {
  display: flex;
  gap: 8px;
  margin-right: 16px;
}

.terminal-button {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  cursor: pointer;
  position: relative;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1),
              0 1px 0 rgba(255, 255, 255, 0.8);
}

.terminal-button.close { 
  background: linear-gradient(135deg, #ff6057 0%, #ff5f57 100%);
}

.terminal-button.minimize { 
  background: linear-gradient(135deg, #ffbe30 0%, #ffbd2e 100%);
}

.terminal-button.maximize { 
  background: linear-gradient(135deg, #29c940 0%, #27c93f 100%);
}

.terminal-title {
  color: #6a737d;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  text-align: center;
  margin-right: 44px;
  letter-spacing: 0.2px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
}

.terminal-tabs {
  display: flex;
  background: #fafbfc;
  border-bottom: 1px solid #d1d5da;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #d1d5da #fafbfc;
  position: relative;
}

.terminal-tabs::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, #d1d5da 10%, #d1d5da 90%, transparent);
  pointer-events: none;
}

.terminal-tabs::-webkit-scrollbar {
  height: 8px;
}

.terminal-tabs::-webkit-scrollbar-track {
  background: #f6f8fa;
  border-radius: 4px;
}

.terminal-tabs::-webkit-scrollbar-thumb {
  background: #d1d5da;
  border-radius: 4px;
  border: 2px solid #f6f8fa;
}

.terminal-tabs::-webkit-scrollbar-thumb:hover {
  background: #959da5;
}

.terminal-tab {
  padding: 11px 20px;
  color: #586069;
  background: transparent;
  border: none;
  border-right: 1px solid #e1e4e8;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica', 'Arial', sans-serif;
  font-size: 13px;
  white-space: nowrap;
  position: relative;
  font-weight: 500;
  letter-spacing: 0.1px;
}

.terminal-tab:hover {
  background: #f3f4f6;
  color: #24292e;
}

.terminal-tab.active {
  background: #ffffff;
  color: #24292e;
  font-weight: 600;
  border-bottom: 2px solid #2c79d6;
  padding-bottom: 9px;
}

.terminal-tab.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(180deg, rgba(44, 121, 214, 0.15), transparent);
}

.terminal-tab.active::after {
  display: none;
}

.terminal-content {
  background: #ffffff;
  padding: 24px;
  max-height: 700px;
  overflow-y: auto;
  color: #24292e;
  scroll-behavior: smooth;
  font-size: 13.5px;
}

.terminal-content::-webkit-scrollbar {
  width: 14px;
}

.terminal-content::-webkit-scrollbar-track {
  background: #f6f8fa;
  border-left: 1px solid #e1e4e8;
}

.terminal-content::-webkit-scrollbar-thumb {
  background: #d1d5da;
  border-radius: 7px;
  border: 3px solid #f6f8fa;
  transition: background 0.2s ease;
}

.terminal-content::-webkit-scrollbar-thumb:hover {
  background: #959da5;
}

.terminal-content::-webkit-scrollbar-thumb:active {
  background: #6a737d;
}

/* Mobile responsive adjustments */
.terminal-mobile-adjust { display: none; }

.trace-step {
  margin-bottom: 14px;
  background: #f6f8fa;
  border-radius: 6px;
  border-left: 3px solid #d1d5da;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(27, 31, 35, 0.06);
}

.trace-step:hover {
  background: #f3f4f6;
}

.trace-step.system {
  border-left-color: #8250df;
  background: linear-gradient(to right, rgba(130, 80, 223, 0.08) 0%, #f6f8fa 8px);
}

.trace-step.user {
  border-left-color: #2c79d6;
  background: linear-gradient(to right, rgba(44, 121, 214, 0.08) 0%, #f6f8fa 8px);
}

.trace-step.assistant {
  border-left-color: #3b8e2c;
  background: linear-gradient(to right, rgba(59, 142, 44, 0.08) 0%, #f6f8fa 8px);
}

.trace-step.tool {
  border-left-color: #d97917;
  background: linear-gradient(to right, rgba(217, 121, 23, 0.08) 0%, #f6f8fa 8px);
}

.trace-step.observation {
  border-left-color: #eb6935;
  background: linear-gradient(to right, rgba(235, 105, 53, 0.08) 0%, #f6f8fa 8px);
}

.trace-step.collapsed .step-content {
  display: none;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.step-header:hover {
  background: rgba(27, 31, 35, 0.04);
}

.step-collapse-icon {
  font-size: 11px;
  color: #6a737d;
  font-family: monospace;
  width: 14px;
  text-align: center;
  font-weight: bold;
  transition: transform 0.2s ease;
}

.trace-step.collapsed .step-collapse-icon {
  transform: rotate(-90deg);
}

.step-icon {
  font-size: 16px;
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.1));
}

.step-label {
  color: #24292e;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.8px;
  flex: 1;
  font-weight: 700;
}

.step-preview {
  color: #6a737d;
  font-size: 11.5px;
  font-weight: 500;
  max-width: 450px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  background: rgba(175, 184, 193, 0.2);
  padding: 3px 8px;
  border-radius: 3px;
}

.step-content-wrapper {
  padding: 0 16px 16px 16px;
}

.step-content {
  color: #586069;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.65;
  font-size: 13px;
}

.step-content.thinking {
  color: #0969da;
  font-style: italic;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(186, 210, 243, 0.12) 0%, rgba(186, 210, 243, 0.08) 100%);
  border-radius: 6px;
  border-left: 3px solid #2c79d6;
  box-shadow: inset 0 1px 2px rgba(44, 121, 214, 0.1);
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
}

.step-content.tool-call {
  color: #d1242f;
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  background: linear-gradient(135deg, #fafbfc 0%, #f6f8fa 100%);
  padding: 14px 16px;
  border-radius: 6px;
  font-size: 12.5px;
  overflow-x: auto;
  border: 1px solid #e1e4e8;
  box-shadow: inset 0 1px 2px rgba(27, 31, 35, 0.05);
}

.step-content.tool-call::-webkit-scrollbar {
  height: 8px;
}

.step-content.tool-call::-webkit-scrollbar-track {
  background: #f6f8fa;
  border-radius: 4px;
}

.step-content.tool-call::-webkit-scrollbar-thumb {
  background: #d1d5da;
  border-radius: 4px;
}

.step-content.observation {
  color: #24292e;
  background: linear-gradient(135deg, #fafbfc 0%, #f6f8fa 100%);
  padding: 14px 16px;
  border-radius: 6px;
  max-height: 450px;
  overflow-y: auto;
  font-size: 12.5px;
  border: 1px solid #e1e4e8;
  box-shadow: inset 0 1px 2px rgba(27, 31, 35, 0.05);
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
}

.step-content.observation::-webkit-scrollbar {
  width: 10px;
}

.step-content.observation::-webkit-scrollbar-track {
  background: #f6f8fa;
  border-radius: 5px;
}

.step-content.observation::-webkit-scrollbar-thumb {
  background: #d1d5da;
  border-radius: 5px;
  border: 2px solid #f6f8fa;
}

.step-content.observation::-webkit-scrollbar-thumb:hover {
  background: #959da5;
}

.trace-metadata {
  margin-top: 24px;
  margin-bottom: 28px;
  padding: 18px 20px;
  background: linear-gradient(135deg, #fafbfc 0%, #f6f8fa 100%);
  border-radius: 8px;
  font-size: 12.5px;
  color: #586069;
  border: 1px solid #e1e4e8;
  box-shadow: 0 2px 4px rgba(27, 31, 35, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.metadata-title {
  font-weight: 700;
  color: #24292e;
  margin-bottom: 14px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.metadata-row {
  display: flex;
  gap: 14px;
  margin-bottom: 10px;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px solid rgba(209, 213, 218, 0.3);
}

.metadata-row:last-child {
  margin-bottom: 0;
  border-bottom: none;
}

.metadata-label {
  font-weight: 700;
  color: #586069;
  min-width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.metadata-value {
  color: #24292e;
  flex: 1;
  word-break: break-word;
  font-weight: 500;
}

.metadata-value.success {
  color: #22863a;
  font-weight: 700;
}

.metadata-value.error {
  color: #cb2431;
  font-weight: 700;
}

.trace-controls {
  margin-bottom: 18px;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fafbfc 0%, #f6f8fa 100%);
  border-radius: 8px;
  border: 1px solid #e1e4e8;
  box-shadow: 0 1px 3px rgba(27, 31, 35, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.control-button {
  padding: 8px 16px;
  background: linear-gradient(180deg, #fafbfc 0%, #f3f4f6 100%);
  color: #24292e;
  border: 1px solid #d1d5da;
  border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica', 'Arial', sans-serif;
  font-size: 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 600;
  box-shadow: 0 1px 0 rgba(27, 31, 35, 0.04),
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.control-button:hover {
  background: linear-gradient(180deg, #f6f8fa 0%, #e1e4e8 100%);
  border-color: #959da5;
}

.control-button:active {
  background: linear-gradient(180deg, #e1e4e8 0%, #d1d5da 100%);
  box-shadow: inset 0 2px 3px rgba(27, 31, 35, 0.12);
}

.control-label {
  color: #6a737d;
  font-size: 11px;
  margin-right: 8px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 600;
}

.loading-message {
  color: #6a737d;
  text-align: center;
  padding: 80px 40px;
  font-size: 14px;
  font-weight: 500;
}

.loading-spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 3px solid #e1e4e8;
  border-top-color: #2c79d6;
  border-radius: 50%;
  animation: trace-spinner-rotation 0.8s linear infinite;
  margin-right: 12px;
  vertical-align: middle;
  box-shadow: 0 2px 4px rgba(27, 31, 35, 0.1);
}

.trace-animation-keyframes { 
  /* Keyframe animation defined inline to avoid @ symbol parsing issues */
  animation-name: trace-spinner-rotation;
}

.empty-state {
  text-align: center;
  padding: 80px 40px;
  color: #6a737d;
}

.empty-state-icon {
  font-size: 56px;
  margin-bottom: 20px;
  opacity: 0.6;
  filter: drop-shadow(0 2px 4px rgba(27, 31, 35, 0.15));
}

.empty-state-text {
  font-size: 15px;
  line-height: 1.6;
  color: #586069;
  font-weight: 500;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  background: #f6f8fa;
  color: #586069;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 700;
  margin-left: auto;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  border: 1px solid #d1d5da;
  box-shadow: 0 1px 2px rgba(27, 31, 35, 0.05);
}

.step-badge.step-number {
  background: linear-gradient(135deg, #bad2f3 0%, #a6c7ed 100%);
  color: #0969da;
  border-color: #2c79d6;
  font-weight: 800;
}

.trace-step.system .step-badge { 
  background: linear-gradient(135deg, rgba(130, 80, 223, 0.15) 0%, rgba(130, 80, 223, 0.1) 100%);
  color: #8250df; 
  border-color: #8250df;
}
.trace-step.user .step-badge { 
  background: linear-gradient(135deg, #bad2f3 0%, #a6c7ed 100%);
  color: #0969da; 
  border-color: #2c79d6;
}
.trace-step.assistant .step-badge { 
  background: linear-gradient(135deg, #bfe3b4 0%, #aed9a1 100%);
  color: #22863a; 
  border-color: #3b8e2c;
}
.trace-step.tool .step-badge { 
  background: linear-gradient(135deg, rgba(217, 121, 23, 0.15) 0%, rgba(217, 121, 23, 0.1) 100%);
  color: #d97917; 
  border-color: #d97917;
}
.trace-step.observation .step-badge { 
  background: linear-gradient(135deg, #f9ccbc 0%, #f7bba8 100%);
  color: #cb2431; 
  border-color: #eb6935;
}
</style>

<script>
(function() {
  const traceFiles = [
    {
      name: 'WebQA Correct',
      file: 'webqa_correct.json',
      description: '✓ Successful multi-hop search',
      category: 'correct'
    },
    {
      name: 'WebQA Error',
      file: 'webqa_error.json',
      description: '✗ Search failure',
      category: 'error'
    },
    {
      name: 'WebQA Repeated Query',
      file: 'webqa_creditassignment_error_ABNORMAL_REPEATED_QUERY.json',
      description: '⚠ Repeated query anomaly',
      category: 'anomaly'
    },
    {
      name: 'WebQA Direct Submit',
      file: 'webqa_creditassignment_error_ABNORMAL_DIRECT_SUBMIT_WITHOUT_TOOL.json',
      description: '⚠ Direct submit without tools',
      category: 'anomaly'
    },
    {
      name: 'MCP Correct',
      file: 'mcp_correct.json',
      description: '✓ Successful tool orchestration',
      category: 'correct'
    },
    {
      name: 'MCP Error',
      file: 'mcp_error.json',
      description: '✗ Tool execution failure',
      category: 'error'
    },
    {
      name: 'MCP Parse Error',
      file: 'mcp_creditassignment_error_ABNORMAL_PARSE_ERROR.json',
      description: '⚠ Parse error anomaly',
      category: 'anomaly'
    },
    {
      name: 'MCP Think Parse Error',
      file: 'mcp_creditassignment_error_ABNORMAL_THINK_PARSE_ERROR.json',
      description: '⚠ Thinking parse error',
      category: 'anomaly'
    }
  ];

  let currentTrace = null;
  let currentTabIndex = 0;

  function createTerminalUI() {
    const container = document.getElementById('trace-viewer-container');
    if (!container) return;

    const terminal = document.createElement('div');
    terminal.className = 'terminal-window';
    
    terminal.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-buttons">
          <div class="terminal-button close"></div>
          <div class="terminal-button minimize"></div>
          <div class="terminal-button maximize"></div>
        </div>
        <div class="terminal-title">Odyssey Agent Traces: Interactive Viewer</div>
      </div>
      <div class="terminal-tabs" id="trace-tabs"></div>
      <div class="terminal-content" id="trace-content">
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-text">Select a trace from the tabs above to begin analysis</div>
        </div>
      </div>
    `;
    
    container.appendChild(terminal);
    
    const tabsContainer = document.getElementById('trace-tabs');
    traceFiles.forEach((trace, index) => {
      const tab = document.createElement('button');
      tab.className = 'terminal-tab' + (index === 0 ? ' active' : '');
      tab.textContent = trace.name;
      tab.title = trace.description;
      tab.onclick = () => loadTrace(index);
      tabsContainer.appendChild(tab);
    });
    
    loadTrace(0);
  }

  async function loadTrace(index) {
    currentTabIndex = index;
    const trace = traceFiles[index];
    
    document.querySelectorAll('.terminal-tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
    });
    
    const content = document.getElementById('trace-content');
    content.innerHTML = '<div class="loading-message"><span class="loading-spinner"></span>Loading trace data...</div>';
    
    try {
      // Get base URL from the current page path
      const basePath = window.location.pathname.replace(/\/[^\/]*$/, '');
      const response = await fetch(`${basePath}/trace_example/${trace.file}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const text = await response.text();
      
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from server');
      }
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Response preview:', text.substring(0, 200));
        throw new Error(`Invalid JSON: ${parseError.message}`);
      }
      
      currentTrace = data;
      renderTrace(data, trace);
    } catch (error) {
      console.error('Trace loading error:', error);
      content.innerHTML = `
        <div class="loading-message" style="color: var(--gh-danger-fg);">
          ⚠️ Error loading trace: ${escapeHtml(error.message)}<br><br>
          <span style="color: var(--gh-fg-subtle); font-size: 11px;">
            File: ${trace.file}<br>
            Check browser console for details.
          </span>
        </div>
      `;
    }
  }

  function renderTrace(data, traceInfo) {
    const content = document.getElementById('trace-content');
    const steps = data.trajectories?.[0]?.steps || [];
    
    let html = '';
    let stepCounter = 0;
    
    // Metadata section
    html += `
      <div class="trace-metadata">
        <div class="metadata-title">📋 Task Information</div>
        <div class="metadata-row">
          <span class="metadata-label">Question:</span>
          <span class="metadata-value">${escapeHtml(truncateText(data.task?.question || data.task?.data_source || 'N/A', 200))}</span>
        </div>
        <div class="metadata-row">
          <span class="metadata-label">Data Source:</span>
          <span class="metadata-value">${data.task?.data_source || 'N/A'}</span>
        </div>
        <div class="metadata-row">
          <span class="metadata-label">Result:</span>
          <span class="metadata-value ${data.is_correct ? 'success' : 'error'}">
            ${data.is_correct ? '✓ Correct' : '✗ Incorrect'} (Reward: ${data.workflow_reward})
          </span>
        </div>
        <div class="metadata-row">
          <span class="metadata-label">Steps:</span>
          <span class="metadata-value">${data.metrics?.['traj/steps'] || 'N/A'}</span>
        </div>
        <div class="metadata-row">
          <span class="metadata-label">Tool Calls:</span>
          <span class="metadata-value">${data.metrics?.tool_calls || 'N/A'}</span>
        </div>
        <div class="metadata-row">
          <span class="metadata-label">Termination:</span>
          <span class="metadata-value">${data.termination_reason}</span>
        </div>
        ${data.metrics?.['anomaly/parse_count'] ? `
        <div class="metadata-row">
          <span class="metadata-label">Anomalies:</span>
          <span class="metadata-value error">
            Parse: ${data.metrics['anomaly/parse_count'] || 0}, 
            Tool: ${data.metrics['anomaly/tool_count'] || 0}, 
            Repetition: ${data.metrics['anomaly/repetition_count'] || 0}
          </span>
        </div>
        ` : ''}
      </div>
    `;
    
    // Controls
    html += `
      <div class="trace-controls">
        <span class="control-label">Controls:</span>
        <button class="control-button" onclick="window.traceViewer.expandAll()">▼ Expand All</button>
        <button class="control-button" onclick="window.traceViewer.collapseAll()">▶ Collapse All</button>
        <button class="control-button" onclick="window.traceViewer.collapseThinking()">💭 Hide Thinking</button>
      </div>
    `;
    
    // Render conversation steps
    steps.forEach((step, idx) => {
      // System prompt (first step only)
      if (idx === 0 && step.chat_completions && step.chat_completions[0]) {
        const systemMsg = step.chat_completions[0];
        if (systemMsg.role === 'system') {
          const preview = truncateText(systemMsg.content, 80);
          const wordCount = systemMsg.content.split(/\s+/).length;
          html += createTraceStep('system', '🔧', 'System Prompt', 
            systemMsg.content, '', preview, 'system', `${wordCount} words`);
        }
      }
      
      // User message
      if (step.chat_completions) {
        const userMsg = step.chat_completions.find(m => m.role === 'user');
        if (userMsg) {
          stepCounter++;
          const cleanContent = userMsg.content.replace(/<[^>]*>/g, '').trim();
          const preview = truncateText(cleanContent, 80);
          const wordCount = cleanContent.split(/\s+/).length;
          html += createTraceStep('user', '👤', `User Message`, 
            cleanContent, '', preview, `step${idx}_user`, `Step ${stepCounter} · ${wordCount} words`);
        }
      }
      
      // Assistant thinking
      if (step.thought) {
        const thinkingContent = extractThinking(step.thought);
        const preview = truncateText(thinkingContent, 80);
        const wordCount = thinkingContent.split(/\s+/).length;
        html += createTraceStep('assistant', '💭', `Thinking`, 
          thinkingContent, 'thinking', preview, `step${idx}_thinking`, `${wordCount} words`);
      }
      
      // Tool call
      if (step.action) {
        const toolContent = extractToolCall(step.action);
        const preview = truncateText(toolContent.replace(/\s+/g, ' '), 80);
        const lines = toolContent.split('\n').length;
        html += createTraceStep('tool', '🔧', `Tool Call`, 
          toolContent, 'tool-call', preview, `step${idx}_tool`, `${lines} lines`);
      }
      
      // Observation
      if (step.observation) {
        const obsContent = extractObservation(step.observation);
        const preview = truncateText(obsContent.replace(/\s+/g, ' '), 80);
        const charCount = obsContent.length;
        html += createTraceStep('observation', '📊', `Observation`, 
          obsContent, 'observation', preview, `step${idx}_obs`, `${charCount} chars`);
      }
    });
    
    if (!html || steps.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-text">No trace steps found in this file</div>
        </div>
      `;
      return;
    }
    
    content.innerHTML = html;
    
    // Add click handlers for collapsing
    document.querySelectorAll('.step-header').forEach(header => {
      header.addEventListener('click', function() {
        this.parentElement.classList.toggle('collapsed');
      });
    });
  }

  function createTraceStep(type, icon, label, content, contentClass = '', preview = '', stepId = '', badge = '') {
    return `
      <div class="trace-step ${type} collapsed" data-step-id="${stepId}">
        <div class="step-header">
          <span class="step-collapse-icon">▼</span>
          <span class="step-icon">${icon}</span>
          <span class="step-label">${label}</span>
          <span class="step-preview">${escapeHtml(preview)}</span>
          ${badge ? `<span class="step-badge">${badge}</span>` : ''}
        </div>
        <div class="step-content-wrapper">
          <div class="step-content ${contentClass}">${escapeHtml(content)}</div>
        </div>
      </div>
    `;
  }

  // Export functions for control buttons
  window.traceViewer = {
    expandAll: function() {
      document.querySelectorAll('.trace-step.collapsed').forEach(step => {
        step.classList.remove('collapsed');
      });
    },
    collapseAll: function() {
      document.querySelectorAll('.trace-step').forEach(step => {
        step.classList.add('collapsed');
      });
    },
    collapseThinking: function() {
      document.querySelectorAll('.trace-step.assistant').forEach(step => {
        if (step.querySelector('.step-content.thinking')) {
          step.classList.add('collapsed');
        }
      });
    }
  };

  function extractThinking(thought) {
    const match = thought.match(/<think>([\s\S]*?)<\/think>/);
    return match ? match[1].trim() : thought;
  }

  function extractToolCall(action) {
    const match = action.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return match[1];
      }
    }
    return action;
  }

  function extractObservation(observation) {
    const match = observation.match(/<tool_response>([\s\S]*?)<\/tool_response>/);
    let content = match ? match[1].trim() : observation;
    
    // Try to format as JSON if it looks like JSON
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed, null, 2);
      } catch {
        // Not valid JSON, return as is
      }
    }
    
    // Clean up execution output formatting
    content = content.replace(/Execution output of \[(.*?)\]:\s*/g, '[$1] Output:\n');
    
    return content;
  }

  function truncateText(text, maxLength) {
    if (!text) return '';
    text = String(text);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createTerminalUI);
  } else {
    createTerminalUI();
  }
})();
</script>

The trace viewer above provides eight representative examples:

- **Correct Traces**: Show successful reasoning patterns where the agent correctly decomposes queries, issues appropriate tool calls, and synthesizes accurate answers
- **Error Traces**: Reveal failure modes such as incorrect tool selection, malformed queries, or premature termination
- **Anomaly Traces**: Highlight edge cases detected by HCA including repeated queries, parse errors, and direct submission without tool use

Each trace displays the complete interaction flow with color-coded components (purple for system, blue for user, green for assistant, yellow for tools, orange for observations). The thinking blocks reveal the agent's internal reasoning process, while tool calls and observations show the external interaction loop.

## Promising Future

**On AI4AI**: The real bottleneck isn't any single component. Sometimes the model isn't wrong, the harness is, or the environment design, or the task spec. We're experimenting with coding agents that close the loop on case analysis, error attribution, debugging, and validation across environment evolution, tool repair, verifier iteration, and infrastructure optimization. The model doesn't need to be smarter than humans, it needs to be faster at iteration and willing to test variations humans wouldn't bother with.

**Multi-Agent Environments**: Verification shifts from "did the agent reach state $s$?" to "did the interaction converge to equilibrium?"

**Cross-Environment Composition**: Can an agent trained on movie databases and travel booking handle "find a theater near my hotel showing a Nolan film"? Tool schemas must align, verifiers must compose, and credit assignment must trace failures across domain boundaries.

**Real-Time RL**: Production agents face queries that don't wait for nightly training runs. Requires streaming RL algorithms that handle concept drift, plus online environment synthesis.

**Harness Meta-Optimization**: As the harness grows to thousands of environments, optimizing the composition becomes its own problem: curriculum learning, active task selection, automated verifier synthesis.

## Open Source

We will release the synthesized environments and tasks with detailed audit records in the near future, along with the trained models and key infrastructure implementations. Hope to enable the community to reproduce our results, and contribute to the development of more capable language agents.

## Acknowledgements

This work builds upon and benefits from several outstanding open-source projects:

- **[Slime](https://github.com/THUDM/slime)**: The foundational RL training infrastructure that Odyssey-Infra extends for agentic workloads.
- **[Asearcher](https://github.com/inclusionAI/ASearcher)**: Web search capabilities that influenced our WebQA/Retrieval environment design.
- **[SearchAgent-Zero](https://github.com/NLPJCL/SearchAgent-Zero)**: Web search agentic RL framework that influenced our training recipe design.
- **[R2E-Gym](https://github.com/R2E-Gym/R2E-Gym)**: Reinforcement learning environment suite for SWE that inspired our agent scaffolds.
- **[DeepSeek-V3.2](https://arxiv.org/abs/2512.02556)**: Prior environment synthesis methods that informed our training recipes.
- **[Defending Against the Training-Inference Numeric Mismatch in RL](https://yichuan-w.github.io/blog/GDN-train-inference-mismatch-asyncRL)**: Inspired us on the implications of zero train-inference mismatch in modern RL, especially for large-scale fully async runs.

We are grateful to the maintainers and contributors of these projects for making their work openly available. Their efforts have significantly accelerated our research and development.

## Contributors

**Core Contributors**: Shuhan Qin, Yang Liu, Jiaqi Li, Jun Bai, Xiaobo Wang  
**Project Leads**: Yang Liu, Zilong Zheng  
**Environment Synthesis Pipeline**: Xiaobo Wang, Jiaqi Li, Tong Wu, Jun Bai, Zhe Li  
**RL Recipe & RL Infra**: Yang Liu, Shuhan Qin  
**Experiments and Evaluation**: Yang Liu, Shuhan Qin  
**Corresponding Author**: Zilong Zheng

## Citation

If you find Odyssey useful in your research, please cite our work:

```bibtex
@article{qin2026odyssey,
  title={Odyssey: Forging Language Agents with Synthesized Environments and Mixed RL at a Humble Scale},
  author={Qin, Shuhan and Liu, Yang and Li, Jiaqi and Bai, Jun and Wang, Xiaobo and Wu, Tong and Wang, Yanting and Yao, Gang and Chen, Hao and Jia, Zixia and Zheng, Zilong},
  year={2026},
  month={September},
  url={https://tongagents.mybigai.ac.cn/en/index/odyssey}
}
```
