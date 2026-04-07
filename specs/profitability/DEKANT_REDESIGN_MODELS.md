# DekantPM Redesign And Alternative Model Analysis

Analyzed on April 7, 2026 from:

- `https://pa-ya.github.io/dekantpm/`
- `https://pa-ya.github.io/dekantpm/math_doc_script.js`
- `https://www.paradigm.xyz/2024/12/distribution-markets`
- `https://mason.gmu.edu/~rhanson/mktscore.pdf`
- `https://ideas.repec.org/p/arx/papers/1206.5252.html`
- `https://courses.cs.duke.edu/cps296.3/spring07/pennock-ec-2004-dynamic-parimutuel.pdf`

Important note:

- This document combines source-backed comparison with engineering inference.
- The Paradigm, Hanson, Chen-Pennock, and Pennock DPM facts are source-backed.
- The proposed hybrid architectures and rankings are my design inference from those sources and from your current DekantPM implementation.

## Executive Answer

If your hard requirements are:

- continuous-outcome prediction
- visible aggregate consensus of all users
- both buying and selling
- native liquidity provision
- credible trader and LP profitability
- clean resolution
- practical onchain implementation

then the best path is not a pure jump from "bins" to "parametric cost function."

The best path is:

1. Fix the current binned model so it becomes economically correct.
2. Replace winner-take-all settlement with smooth continuous settlement.
3. Preserve a Paradigm-like backing identity for LPs and traders.
4. Over time, move from plain bins to a richer continuous representation such as basis functions or a restricted-family function-space model.

My direct recommendation is:

- near-term production path: an improved binned model
- medium-term best compromise: a basis-function or semi-parametric continuous market
- long-term most faithful continuous design: a Paradigm-style restricted-family function-space market

If native LPs are a hard requirement, then a pure LMSR-style or cost-function-only market is not the best primary architecture.

## First Clarification: Two Different Design Axes

You are currently comparing "bins" with things like "parametric cost function design." These are not the same kind of choice.

There are two separate axes:

### 1. State Representation

This is how the market represents the continuous belief.

Examples:

- finite bins / histogram
- parametric family such as Normal with `mu` and `sigma`
- mixture of parametric families
- basis functions or splines
- full function-space object `f(x)`

### 2. Market-Maker / Collateralization Design

This is how prices, solvency, LPs, and trader positions are implemented.

Examples:

- pool-backed LP AMM
- cost-function / market-scoring-rule AMM
- redistributive dynamic pari-mutuel market
- central limit-order-book with optional market makers

So:

- "bins" and "parametric" are representation choices
- "pool-based" and "cost-function-based" are market-maker choices

You can combine them.

Examples:

- binned + pool-backed
- binned + cost-function
- parametric + cost-function
- basis-function + pool-backed
- restricted-family function-space + Paradigm-style collateralization

This matters because several of your current problems are not caused by using bins. They are caused by your current accounting and settlement choices.

## Non-Negotiable Product Requirements

From your request, the architecture should support:

- continuous-outcome questions
- aggregate consensus from all users, not just the most recent user
- buying and selling
- native or at least clean liquidity provision
- realistic profit opportunity for informed traders
- a plausible fee-based business case for LPs
- robust resolution
- practical implementation complexity

One more truth must be stated clearly:

- no prediction-market design can make both traders and LPs structurally positive expected value at the same time without subsidy

What a good design can do is:

- give informed traders a clean path to profit
- give LPs a plausible fee-compensated role
- make consensus visible
- avoid mechanical losses that are caused by bad accounting rather than actual market risk

## What The Sources Say That Matters Here

Paradigm's article says:

- the AMM holds `h(x) = b - f(x)`
- traders collectively hold `f(x)`
- in an efficient market, `f` is proportional to the true distribution within the model constraints
- traders moving the market from `f` to `g` hold `g - f`
- traders must collateralize `-min_x (g(x) - f(x))`
- LPs add liquidity by adding a scalar multiple of the AMM's position and keeping the matching scalar multiple of trader-side exposure
- market holdings plus all participant holdings continue to sum to total backing `b`

Hanson's market scoring rule paper says:

- a market scoring rule functions as an automated market maker
- its internal state summarizes cumulative prior activity
- it produces consensus estimates, not just the last trader's report

Chen and Pennock say:

- bounded-loss market makers can be implemented naturally with cost functions
- there is a tradeoff between liquidity and worst-case loss
- cost-function implementation is a natural implementation form

Pennock's dynamic pari-mutuel paper says:

- you can get infinite buy liquidity and zero operator risk
- prices can react continuously
- but sell-side liquidity is not guaranteed by the same market maker

These facts imply a design lesson:

- if LPs are central, you need a clean pool/backing identity
- if broad continuous trader expression is central, you need smooth payout, not single-bin winner-take-all
- if operator simplicity and bounded subsidy are central, cost-function markets are attractive
- if operator risk must be zero, dynamic pari-mutuel designs are attractive, but they are weak on native LP design

## Recommended Redesign For DekantPM

### The Core Recommendation

Do not throw away bins immediately.

Instead, build `DekantPM v2` as:

- a pool-backed continuous-outcome market
- still using finite approximation at first
- but with smooth settlement
- correct LP/trader/backing accounting
- optional signed shape trades with explicit max-loss collateral

That gets you much closer to Paradigm economically without demanding full function-space machinery on day one.

### DekantPM v2 Specification

### 1. Separate Backing From Consensus State

Introduce:

- `b`: backing / max total payout capacity
- `f`: aggregate trader-held outcome exposure
- `h = b - f`: AMM holdings
- `k`: norm or liquidity-shape parameter if you still want an `L2` geometry

Do not let a single scalar like current `k` do all jobs at once.

This follows Paradigm's key lesson:

- backing and shape are different concepts

### 2. Preserve The Backing Identity

At all times, enforce:

- market holdings plus all user-held outcome claims equals total backing

This is the single most important accounting fix.

It prevents:

- the current deterministic LP no-trader loss
- stranded value at resolution
- ambiguity about whether `positions` means AMM state or trader inventory

### 3. Keep Bins If Needed, But Settle Smoothly

Do not resolve by:

- choosing exactly one winning bin

Instead resolve by:

- a local payout kernel around the realized value
- or linear interpolation between adjacent bins
- or a smooth normalized kernel such as triangular or Gaussian

This change is not cosmetic. It directly improves:

- broad-distribution trader profitability
- payoff fidelity for continuous beliefs
- alignment with the idea of a continuous market

### 4. Replace "Displayed Quadratic Probability" As The Main User Quote

Show at least these two things:

- consensus shape
- real marginal trade quote / break-even economics

Your current displayed `p_hat` is not the right economic object for ordinary users.

Use user-facing quotes such as:

- marginal payout per additional dollar
- break-even implied probability
- expected payout under current consensus

The quadratic display can remain as an internal or secondary diagnostic if you still like the geometry.

### 5. Support Signed Shape Trades

If you want to become genuinely more Paradigm-like, traders must eventually be able to do more than buy long-only positive bundles.

That means supporting trades that move the state from `f` to `g`, where the trader receives:

- `g - f`

and posts collateral equal to:

- the worst negative region of that position

In a binned approximation, this becomes:

- collateral = max over bins of negative exposure, or a smoothed analogue if settlement is smooth

This is what lets a trader:

- buy one shape
- sell another shape
- express relative views, not only long-only views

### 6. Fix LP Minting And Withdrawal

LP minting should behave like:

- add a proportional share of current AMM holdings
- keep the matching trader-side reference share
- receive fungible LP shares

LP withdrawal should give:

- a pro-rata share of the actual residual backed pool
- plus accumulated fees

not an arbitrary function of a state variable that no longer matches real outstanding claims.

### 7. Use Nonzero Default Fees

The implementation should not default to zero if LPs are meant to exist.

Use:

- nonzero default trade fee
- nonzero LP fee share
- nonzero resolution/redemption fee only if you truly want it

I would also consider:

- wider fees for wider distribution changes
- impact-sensitive fees
- optional lower fees for trades that add liquidity to underrepresented regions

### 8. If You Keep Bins, Make Them Better

Even without leaving the binned architecture, you can improve it materially:

- use non-uniform bins, denser where probability mass is likely
- allow dynamic refinement in high-interest regions
- optionally represent tails more coarsely than the center

That reduces one of the worst bin costs:

- wasting state resolution where users do not care

## Alternative Model Families

Below I compare the main alternatives you should seriously consider.

### Model A: Improved Binned Pool-Backed Market

This is your current model's best version, not the current implementation.

### State Representation

- finite bins over the continuous outcome range

### Market-Maker Design

- pool-backed AMM with LP shares
- proper backing identity
- smooth payout kernel at resolution

### Does It Support Your Requirements?

- continuous question: yes
- aggregate consensus of all users: yes
- buying: yes
- selling: yes
- native LPs: yes
- resolution: yes
- trader profitability: yes, especially if settlement is made smooth
- LP profitability: possible, if fees and accounting are correct

### Strengths

- easiest upgrade from your current codebase
- easiest user mental model
- native LP role
- explicit visible consensus curve
- works well with UI, charts, and portfolio views

### Weaknesses

- still only an approximation to a true continuous object
- fixed bins create approximation error
- if bins are too coarse, boundary effects remain
- if bins are too many, compute cost rises

### Economic Outlook

- concentrated traders: good
- broad-view traders: much better than current version if settlement is smooth
- LPs: plausible if accounting is fixed and fees are real

### Verdict

This is the best near-term architecture if you want to ship something practical and still preserve LPs.

### Model B: Parametric Cost-Function Market

This is what many people mean when they say:

- "let the market trade `mu`, `sigma`, maybe mixture weights"
- "use a cost function rather than a pool"

### State Representation

- a finite parameter vector such as `theta = (mu, sigma)` or a richer parametric family

### Market-Maker Design

- cost-function AMM / market scoring rule
- bounded loss usually absorbed by sponsor or protocol treasury, not native LPs

### Important Clarification

This model only works as a true market if the state is cumulative.

Good version:

- each trader buys or sells parameterized exposure
- current state aggregates all net order flow

Bad version:

- last trader simply overwrites `mu` and `sigma`

The bad version is not a real prediction market. It is just a last-user report widget.

### Does It Support Your Requirements?

- continuous question: yes
- aggregate consensus of all users: yes, if cumulative cost-function state is used
- buying: yes
- selling: yes
- native LPs: no, not naturally
- resolution: yes
- trader profitability: yes
- LP profitability: weak or no native role

### Strengths

- no bins
- very clean mathematics
- good buy/sell behavior
- consensus state is path-independent in the usual cost-function formulation
- strong bounded-loss theory

### Weaknesses

- no natural permissionless LP role
- family misspecification can be severe
- if the chosen family is too narrow, consensus becomes compressed into the wrong shape
- hard to support "all users' knowledge" if the family is too restrictive

### Economic Outlook

- traders: often strong, especially sophisticated traders
- LPs: poor fit unless you replace LPs with a sponsor, treasury, or market-creation subsidy

### Verdict

If native LPs are mandatory, this should not be your main architecture.

If you are willing to have:

- a sponsor-backed market
- bounded treasury subsidy
- or market creators funding liquidity directly

then this becomes a serious option.

### Model C: Basis-Function Or Spline Coefficient Market

This is the best medium-term compromise in my view.

### State Representation

Represent the continuous belief as:

- `f(x) = sum_i alpha_i phi_i(x)`

where `phi_i` are basis functions such as:

- Gaussian kernels
- splines
- radial basis functions
- wavelets

### Market-Maker Design

Can be combined with either:

- a pool-backed LP AMM
- or a cost-function AMM

### Does It Support Your Requirements?

- continuous question: yes
- aggregate consensus of all users: yes
- buying: yes
- selling: yes
- native LPs: yes if pool-backed, partial or no if cost-function only
- resolution: yes
- trader profitability: yes
- LP profitability: plausible if pool-backed and fee-compensated

### Strengths

- much richer than a fixed parametric family
- more faithful than coarse bins
- smoother settlement and pricing
- can still be finite-dimensional and practical
- lets you tune complexity by choosing the basis size

### Weaknesses

- harder than bins
- harder to explain to casual users
- collateral/risk checks are more complex
- if basis functions overlap heavily, implementation math gets more subtle

### Economic Outlook

- broad-view traders: strong
- concentrated traders: also strong
- LPs: plausible, especially with a pool-backed structure

### Verdict

If you want a serious long-lived product and do not want to stay permanently stuck in histogram logic, this is the strongest compromise.

### Model D: Paradigm-Style Restricted-Family Function-Space Market

This is the most faithful continuous-market direction.

### State Representation

- a continuous outcome function `f(x)`
- in practice, likely restricted to a family such as Normals, mixtures, or other efficiently verifiable shapes

### Market-Maker Design

- pool/backing identity like Paradigm
- trader position is `g - f`
- collateral based on worst negative region
- LPs add proportional liquidity and keep matching exposure

### Does It Support Your Requirements?

- continuous question: yes
- aggregate consensus of all users: yes
- buying: yes
- selling: yes
- native LPs: yes
- resolution: yes
- trader profitability: yes
- LP profitability: structurally plausible

### Strengths

- best match to the idea of a true continuous distribution market
- best consensus fidelity
- best support for shaped and relative views
- clean LP and trader accounting if implemented correctly

### Weaknesses

- highest implementation complexity
- hardest collateral verification
- may need restricted families for onchain feasibility
- hardest UI/UX challenge

### Economic Outlook

- traders: structurally strongest for broad and nuanced beliefs
- LPs: structurally strongest among LP-based continuous models, but still need good fees

### Verdict

This is the best long-term target if you want the product to be recognized as a genuinely continuous prediction market rather than a sophisticated discrete approximation.

### Model E: Dynamic Pari-Mutuel Market

This is not the same design family as Paradigm, but it is worth considering because it has strong operator-side properties.

### State Representation

- outcome claims with redistributive settlement

### Market-Maker Design

- dynamic pari-mutuel mechanism
- zero institution risk

### Does It Support Your Requirements?

- continuous question: yes in principle
- aggregate consensus of all users: yes
- buying: yes
- selling: partial
- native LPs: no
- resolution: yes
- trader profitability: yes
- LP profitability: no native role

### Strengths

- zero operator risk
- infinite buy-side liquidity
- good information aggregation

### Weaknesses

- no natural LP role
- sell-side liquidity is not guaranteed by the same mechanism
- less aligned with your LP-centered product goals

### Verdict

Interesting academically, but not a strong fit if you care deeply about LP participation.

## Comparison Matrix

Support levels:

- `Strong`
- `Partial`
- `Weak`
- `No`

| Model | Native LPs | Buy Liquidity | Sell Liquidity | Aggregate Consensus | Broad Continuous Expression | Smooth Resolution | Trader Profit Potential If Informed | LP Profit Potential | Practicality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current Dekant bins | Strong | Strong | Strong | Strong | Weak | Weak | Partial | Weak | Strong |
| Improved bins | Strong | Strong | Strong | Strong | Partial | Strong | Strong | Partial | Strong |
| Parametric cost-function | No | Strong | Strong | Strong | Partial | Strong | Strong | No | Strong |
| Basis-function market | Partial | Strong | Strong | Strong | Strong | Strong | Strong | Partial | Partial |
| Paradigm-style restricted family | Strong | Strong | Strong | Strong | Strong | Strong | Strong | Strong | Partial |
| Dynamic pari-mutuel | No | Strong | Partial | Partial | Partial | Partial | Partial | No | Partial |

## Which Model Best Preserves "Consensus Of All Users"?

The good news is:

- bins
- cost-function markets
- basis-function markets
- Paradigm-style markets

can all show aggregate consensus of all users.

The key requirement is not the representation alone. It is that:

- the market state is cumulative
- the current state summarizes total net exposure
- users do not simply overwrite each other

So your "not just the last user" concern should be translated into a hard product rule:

- any accepted architecture must maintain a cumulative state variable whose value is determined by all prior trades, not by the identity of the most recent trader

That rule is compatible with all serious market designs above except the naive "last trader edits the parameters" anti-pattern.

## Which Model Best Supports LPs?

Ranking:

1. Paradigm-style restricted-family function-space
2. Improved binned pool-backed market
3. Basis-function pool-backed market
4. Parametric cost-function market
5. Dynamic pari-mutuel market

Reason:

- LPs need a clean share of actual backed market inventory plus fees
- cost-function markets usually give you a bounded-loss sponsor, not a natural permissionless LP role
- DPM gives you zero institution risk, but not a native LP role

So if LPs are not optional, you should bias strongly toward:

- improved bins
- basis functions
- or Paradigm-style restricted-family pool accounting

## Which Model Best Supports Trader Profitability?

For informed concentrated views:

- improved bins can work well
- parametric cost-function can work well
- Paradigm-style can work well

For informed broad continuous views:

- Paradigm-style is best
- basis-function is next best
- improved bins with smooth settlement is acceptable
- current winner-take-all bins are poor

For short-term trading and repricing:

- cost-function and Paradigm-style are strong
- improved bins can also work if slippage and fees are reasonable

## Which Model Best Attracts Users?

This depends on user type.

### Casual Users

Best initial attraction:

- improved bins

Why:

- easiest to understand
- easiest to visualize
- easiest to chart

### Serious Traders

Best attraction:

- Paradigm-style restricted-family
- or basis-function market

Why:

- better expression of nuanced beliefs
- smoother payout
- less artificial boundary behavior

### Serious LPs

Best attraction:

- Paradigm-style restricted-family
- then improved bins with fixed accounting

Why:

- LP role is economically meaningful
- accounting is less likely to generate fake losses

### Overall Product Strategy

If your product goal is:

- easy v1 onboarding and a credible launch

then improved bins is best.

If your product goal is:

- long-run credibility with sophisticated prediction-market users

then a more Paradigm-like architecture wins.

## My Actual Recommendation To You

I would not recommend:

- pure current-style bins
- or pure parametric cost-function as the final product

I would recommend a staged architecture:

#### Stage 1: DekantPM v2

- keep finite approximation
- fix LP accounting
- separate backing from shape
- add smooth settlement
- expose real economic trade quotes
- use nonzero default fees

#### Stage 2: Semi-Parametric Upgrade

- move from plain bins to basis functions or adaptive bins
- keep pool-backed LP design
- support richer trader shapes

#### Stage 3: Paradigm-Like Signed Exposure

- allow `g - f` style signed shape moves
- require explicit max-loss collateral
- keep permissionless LP provision with backing identity

This path keeps:

- your product understandable
- LPs native
- traders able to buy and sell
- consensus visible
- and the long-run architecture pointed toward a genuinely continuous market

## If You Force Me To Choose One Final Architecture

If the choice is purely about long-run design quality under your requirements, my ranking is:

1. Paradigm-style restricted-family function-space market
2. Basis-function pool-backed market
3. Improved binned pool-backed market
4. Parametric cost-function market
5. Dynamic pari-mutuel market

If the choice is purely about best next implementation from where you are today, my ranking is:

1. Improved binned pool-backed market
2. Basis-function pool-backed market
3. Paradigm-style restricted-family market
4. Parametric cost-function market
5. Dynamic pari-mutuel market

## Final Bottom Line

The main lesson is:

- bins are not your real enemy
- bad accounting and winner-take-all settlement are your real enemy

Some differences from Paradigm are unavoidable if you discretize.

But the most economically harmful differences in your current design are choices, not necessities.

So the right move is not:

- "abandon bins immediately"

The right move is:

- "fix the economics first, then upgrade the representation"

If you do that, your market can become:

- much more Paradigm-like
- much more attractive to serious traders
- much safer for LPs
- and still practical enough to build

## Sources

- DekantPM analysis page: `https://pa-ya.github.io/dekantpm/`
- DekantPM implementation script: `https://pa-ya.github.io/dekantpm/math_doc_script.js`
- Paradigm, "Distribution Markets": `https://www.paradigm.xyz/2024/12/distribution-markets`
- Robin Hanson, "Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation": `https://mason.gmu.edu/~rhanson/mktscore.pdf`
- Yiling Chen and David Pennock, "A Utility Framework for Bounded-Loss Market Makers": `https://ideas.repec.org/p/arx/papers/1206.5252.html`
- David Pennock, "A Dynamic Pari-Mutuel Market for Hedging, Wagering, and Information Aggregation": `https://courses.cs.duke.edu/cps296.3/spring07/pennock-ec-2004-dynamic-parimutuel.pdf`
