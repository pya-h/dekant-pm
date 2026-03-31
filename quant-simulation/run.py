"""Entry point for quantitative AMM simulation."""
import argparse
import os
import sys

# Add the quant-simulation directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine.sweeps import run_stage0, run_stage1, select_finalists, run_stage2, run_stage3
from analysis.report import generate_report
from analysis.export import export_all_results, export_mirofish_json
from config.params import (
    DEFAULT_NUM_BINS, DEFAULT_INITIAL_LIQUIDITY, DEFAULT_NUM_ROUNDS, DEFAULT_MC_RUNS,
    DESIGN_NAMES,
)


def main():
    parser = argparse.ArgumentParser(description="Quantitative AMM Simulation")
    parser.add_argument("--mc-runs", type=int, default=DEFAULT_MC_RUNS)
    parser.add_argument("--num-bins", type=int, default=DEFAULT_NUM_BINS)
    parser.add_argument("--num-rounds", type=int, default=DEFAULT_NUM_ROUNDS)
    parser.add_argument("--liquidity", type=int, default=DEFAULT_INITIAL_LIQUIDITY)
    parser.add_argument("--output", type=str, default="quant-simulation/output")
    parser.add_argument("--stage1-only", action="store_true")
    parser.add_argument("--skip-sensitivity", action="store_true")
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()

    mc_runs = args.mc_runs
    num_bins = args.num_bins
    num_rounds = args.num_rounds
    liquidity = args.liquidity
    output_dir = args.output

    if args.quick:
        mc_runs = 10
        num_bins = 16
        num_rounds = 50

    os.makedirs(output_dir, exist_ok=True)

    # Stage 0: Validity
    print("=== Stage 0: Validity Gates ===")
    stage0 = run_stage0(num_bins=num_bins, initial_liquidity=liquidity, num_rounds=num_rounds, mc_runs=min(mc_runs, 5))
    for r in stage0["validity_results"]:
        status = "PASS" if r.passed else "FAIL"
        print(f"  [{status}] {r.gate}: {r.detail}")

    # Stage 1: Mechanism comparison
    print("\n=== Stage 1: Mechanism Comparison ===")
    stage1_df = run_stage1(num_bins=num_bins, initial_liquidity=liquidity, num_rounds=num_rounds, mc_runs=mc_runs)
    finalists = select_finalists(stage1_df, n=3)
    print(f"  Finalists: {[DESIGN_NAMES[d] for d in finalists]}")

    stage2_df = None
    stage3_df = None

    if not args.stage1_only:
        # Stage 2: Fee sweep
        print("\n=== Stage 2: Fee Sweep ===")
        stage2_df = run_stage2(finalists, num_bins=num_bins, initial_liquidity=liquidity, num_rounds=num_rounds, mc_runs=mc_runs)
        print(f"  Completed {len(stage2_df)} fee sweep runs")

    if not args.skip_sensitivity:
        # Stage 3: Sensitivity
        print("\n=== Stage 3: Sensitivity Sweep ===")
        stage3_df = run_stage3(finalists, num_rounds=num_rounds, mc_runs=min(mc_runs, 100))
        print(f"  Completed {len(stage3_df)} sensitivity runs")

    # Export & Report
    print("\n=== Generating Report ===")

    # export_all_results expects (phase1_df, clob_df, ...) — pass stage1 as
    # phase1 and None for clob since CLOB is now embedded in stage1_df.
    export_paths = export_all_results(
        phase1_df=stage1_df,
        clob_df=stage1_df.head(0),  # empty frame with same schema
        phase2_df=stage2_df,
        sensitivity_df=stage3_df,
        output_dir=output_dir,
    )

    generate_report(
        stage1_df,
        stage2_df=stage2_df,
        stage3_df=stage3_df,
        output_dir=output_dir,
        stage0=stage0,
        finalists=finalists,
    )

    mirofish_path = os.path.join(output_dir, "mirofish.json")
    export_mirofish_json(stage1_df, phase2_df=stage2_df, top_n=len(finalists), path=mirofish_path)

    print(f"  Report: {output_dir}/report.html")
    print(f"  Exports: {export_paths}")


if __name__ == "__main__":
    main()
