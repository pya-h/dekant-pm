"""Entry point: Phase 1 → down-select → Phase 2 → report."""
import argparse
import sys
from pathlib import Path

from engine.sweeps import run_phase1, run_clob_phase1, select_top_designs, run_phase2
from analysis.report import generate_report
from analysis.export import export_csv, export_mirofish_json
from config.params import DESIGN_NAMES

def main():
    parser = argparse.ArgumentParser(description="DekantPM AMM Quantitative Simulation")
    parser.add_argument("--mc-runs", type=int, default=1000, help="Monte Carlo runs per combo")
    parser.add_argument("--num-bins", type=int, default=256, help="Number of bins")
    parser.add_argument("--num-rounds", type=int, default=200, help="Trading rounds per run")
    parser.add_argument("--liquidity", type=int, default=10_000_000_000, help="Initial liquidity (native units)")
    parser.add_argument("--output", type=str, default="output", help="Output directory")
    parser.add_argument("--phase1-only", action="store_true", help="Skip Phase 2")
    parser.add_argument("--quick", action="store_true", help="Quick run: 10 MC, 16 bins, 50 rounds")
    args = parser.parse_args()

    if args.quick:
        args.mc_runs = 10
        args.num_bins = 16
        args.num_rounds = 50

    output = Path(args.output)
    output.mkdir(exist_ok=True)

    print(f"=== Phase 1: Design Down-Selection ({6 * args.mc_runs} runs) ===")
    phase1_df = run_phase1(
        num_bins=args.num_bins, initial_liquidity=args.liquidity,
        num_rounds=args.num_rounds, mc_runs=args.mc_runs,
    )
    export_csv(phase1_df, str(output / "phase1_results.csv"))

    print(f"=== Phase 1: CLOB Hybrid ({args.mc_runs} runs) ===")
    clob_df = run_clob_phase1(
        num_bins=args.num_bins, initial_liquidity=args.liquidity,
        num_rounds=args.num_rounds, mc_runs=args.mc_runs,
    )
    export_csv(clob_df, str(output / "clob_results.csv"))

    top_designs = select_top_designs(phase1_df, n=3)
    print(f"=== Top 3 designs: {[DESIGN_NAMES[d] for d in top_designs]} ===")

    phase2_df = None
    if not args.phase1_only:
        print(f"=== Phase 2: Fee Sweep ({3 * 5 * args.mc_runs} runs) ===")
        phase2_df = run_phase2(
            top_designs=top_designs, num_bins=args.num_bins,
            initial_liquidity=args.liquidity, num_rounds=args.num_rounds,
            mc_runs=args.mc_runs,
        )
        export_csv(phase2_df, str(output / "phase2_results.csv"))

    print("=== Generating Report ===")
    report_path = generate_report(phase1_df, phase2_df, args.output)
    print(f"Report: {report_path}")

    export_mirofish_json(phase1_df, top_n=3, path=str(output / "mirofish_export.json"))
    print(f"MiroFish export: {output / 'mirofish_export.json'}")

if __name__ == "__main__":
    main()
