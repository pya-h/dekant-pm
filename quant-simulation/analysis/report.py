"""Generate a standalone HTML report with Plotly charts for simulation results.

Usage:
    from analysis.report import generate_report
    path = generate_report(stage1_df, stage2_df=stage2_df, output_dir="output", stage0=stage0)
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.offline import get_plotlyjs
from jinja2 import Template
from engine.metrics import composite_score
from config.params import DESIGN_CLOB, DESIGN_SCALAR, DESIGN_NAMES

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PLOTLY_JS = get_plotlyjs()

_PHASE1_METRICS = [
    "price_accuracy",
    "convergence_speed",
    "lp_profitability",
    "lp_passive_profitability",
    "lp_rebalancing_profitability",
    "resolution_fairness",
    "exitability_unwind",
]

_LEADERBOARD_METRICS = [
    "price_accuracy",
    "convergence_speed",
    "mean_slippage",
    "lp_profitability",
    "manipulation_resistance",
    "resolution_fairness",
    "boundary_sensitivity_max",
    "exitability_unwind",
]

_METRIC_LABELS = {
    "price_accuracy": "Price Accuracy (KL\u2193)",
    "convergence_speed": "Convergence Speed (rounds\u2193)",
    "lp_profitability": "LP Profitability\u2191",
    "lp_passive_profitability": "Passive LP Profitability\u2191",
    "lp_rebalancing_profitability": "Rebalancing LP Profitability\u2191",
    "mean_slippage": "Capital Efficiency (slippage\u2193)",
    "manipulation_resistance": "Manipulation Resistance\u2191",
    "resolution_fairness": "Resolution Fairness (err\u2193)",
    "boundary_sensitivity_max": "Boundary Sensitivity Max\u2193",
    "boundary_sensitivity_mean": "Boundary Sensitivity Mean\u2193",
    "boundary_payout_jump_max": "Payout Jump Max\u2193",
    "boundary_payout_jump_mean": "Payout Jump Mean\u2193",
    "boundary_incentive_jump_max": "Incentive Jump Max\u2193",
    "boundary_incentive_jump_mean": "Incentive Jump Mean\u2193",
    "exitability_unwind": "Exitability Unwind\u2191",
    "exitability_slippage": "Exitability Slippage\u2193",
    "truthful_incentive_alignment": "Truthful Incentive Alignment\u2191",
    "lp_activation_rate": "LP Activation Rate\u2191",
}

# ---------------------------------------------------------------------------
# HTML Template
# ---------------------------------------------------------------------------

_HTML_TEMPLATE = Template("""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DekantPM Simulation Report</title>
  <script>{{ plotly_js }}</script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: "Inter", "Segoe UI", system-ui, sans-serif;
      line-height: 1.6;
      padding: 2rem;
    }
    h1 { font-size: 1.8rem; margin-bottom: 0.25rem; color: #ffffff; }
    h2 { font-size: 1.3rem; margin: 2rem 0 0.75rem; color: #c0c0c0; border-bottom: 1px solid #2a2a2a; padding-bottom: 0.4rem; }
    h3 { color: #aaa; margin: 1.5rem 0 0.5rem; font-size: 1rem; }
    p.subtitle { color: #888; margin-bottom: 2rem; font-size: 0.9rem; }
    .chart-container { margin: 1rem 0 2rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
    thead tr { background: #1a1a1a; }
    th, td {
      padding: 0.5rem 0.75rem;
      text-align: right;
      border: 1px solid #2a2a2a;
    }
    th:first-child, td:first-child { text-align: left; }
    tbody tr:nth-child(even) { background: #111111; }
    tbody tr:hover { background: #1e1e1e; }
    th { color: #a0a0a0; font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      background: #1f3a2a;
      color: #4caf50;
    }
    .download-link {
      display: inline-block;
      margin: 0.5rem 0;
      color: #4fc3f7;
      text-decoration: none;
      font-size: 0.9rem;
    }
    .download-link:hover { text-decoration: underline; }
    .section-note { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>DekantPM Simulation Report</h1>
  <p class="subtitle">AMM settlement design evaluation &mdash; quantitative analysis output</p>

  {% if stage0_html %}
  <h2>Stage 0: Validity Gates</h2>
  <p class="section-note">Quick sanity checks across all AMM designs before full sweep</p>
  {{ stage0_html }}
  {% endif %}

  <h2>Design Leaderboard (Stage 1)</h2>
  <p class="section-note">Median [p5, p95] across Monte Carlo paths under flat fee</p>
  {{ leaderboard_html }}

  {% if pareto_html %}
  <h2>Pareto Frontier</h2>
  <p class="section-note">Designs on the Pareto front across composite metrics (non-dominated solutions)</p>
  {{ pareto_html }}
  {% endif %}

  <h2>Baseline A vs B Comparison</h2>
  <p class="section-note">Isolating Gaussian weight approximation effect from settlement design changes</p>
  <div class="chart-container">{{ baseline_chart }}</div>

  {% for title, chart in metric_charts %}
  <h2>{{ title }}</h2>
  <div class="chart-container">{{ chart }}</div>
  {% endfor %}

  {% if tia_chart %}
  <h2>Truthful Incentive Alignment</h2>
  <p class="section-note">TIA score by design &mdash; higher means reporting truthful beliefs is more profitable</p>
  <div class="chart-container">{{ tia_chart }}</div>
  {% endif %}

  {% if lp_activation_html %}
  <h2>LP Activation</h2>
  <p class="section-note">LP activation rate and deployment status across designs</p>
  {{ lp_activation_html }}
  {% endif %}

  <h2>KL Divergence Convergence</h2>
  <p class="section-note">Mean KL divergence over trading rounds with p5/p95 bands</p>
  <div class="chart-container">{{ convergence_chart }}</div>

  {% if fairness_heatmap %}
  <h2>Resolution Fairness: Payout by Distance</h2>
  <p class="section-note">Mean actual/ideal payout ratio by distance from resolved bin (1.0 = perfect)</p>
  <div class="chart-container">{{ fairness_heatmap }}</div>
  {% endif %}

  <h2>Boundary Sensitivity</h2>
  <div class="chart-container">{{ boundary_chart }}</div>

  {% if boundary_revised_chart %}
  <h2>Revised Boundary Sensitivity (Payout + Incentive Jumps)</h2>
  <p class="section-note">Payout jump and incentive jump metrics from revised boundary sensitivity analysis</p>
  <div class="chart-container">{{ boundary_revised_chart }}</div>
  {% endif %}

  <h2>Exitability Comparison</h2>
  <div class="chart-container">{{ exitability_chart }}</div>

  {% if scalar_redteam_html %}
  <h2>Scalar Red-Team Analysis</h2>
  <p class="section-note">Red-Team Only &mdash; Scalar design (Design 4) isolated metrics for adversarial review</p>
  {{ scalar_redteam_html }}
  {% endif %}

  {% if clob_section %}
  <h2>CLOB Hybrid Analysis</h2>
  <p class="section-note">Qualitative comparison &mdash; different microstructure, not directly comparable to AMM designs</p>
  {{ clob_section }}
  {% endif %}

  {% if phase2_charts %}
  <h2>Stage 2: Fee Model Comparison</h2>
  {% for title, chart in phase2_charts %}
  <h3>{{ title }}</h3>
  <div class="chart-container">{{ chart }}</div>
  {% endfor %}

  {% if fee_heatmaps %}
  <h2>Fee Mechanism Heatmaps</h2>
  <p class="section-note">Top designs &times; fee mechanisms, per metric</p>
  {% for title, chart in fee_heatmaps %}
  <h3>{{ title }}</h3>
  <div class="chart-container">{{ chart }}</div>
  {% endfor %}
  {% endif %}

  {% if optimal_fee_html %}
  <h2>Optimal Fee per Design</h2>
  <p class="section-note">Best fee mechanism for each surviving design based on composite metric ranking</p>
  {{ optimal_fee_html }}
  {% endif %}
  {% endif %}

  {% if sensitivity_charts %}
  <h2>Stage 3: Sensitivity Analysis</h2>
  <p class="section-note">Results varying bins (16-256), agent mix, and initial liquidity on top designs</p>
  {% for title, chart in sensitivity_charts %}
  <h3>{{ title }}</h3>
  <div class="chart-container">{{ chart }}</div>
  {% endfor %}
  {% endif %}

  <h2>Raw Data</h2>
  <p>
    <a class="download-link" href="results.csv">All runs (CSV)</a><br/>
    <a class="download-link" href="stage1_results.csv">Stage 1 results (CSV)</a><br/>
    {% if has_phase2 %}<a class="download-link" href="stage2_results.csv">Stage 2 results (CSV)</a><br/>{% endif %}
    {% if has_sensitivity %}<a class="download-link" href="sensitivity_results.csv">Sensitivity results (CSV)</a><br/>{% endif %}
    <a class="download-link" href="mirofish_export.json">MiroFish export (JSON)</a>
  </p>
</body>
</html>
""")

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_PLOTLY_LAYOUT = dict(
    paper_bgcolor="#0a0a0a",
    plot_bgcolor="#111111",
    font=dict(color="#e0e0e0"),
    legend=dict(bgcolor="#111111", bordercolor="#333"),
)


def _normalize_for_score(series: pd.Series, invert: bool = False) -> pd.Series:
    """Normalize a metric series to [0, 1] while treating positive infinity as best."""
    values = series.astype(np.float64).to_numpy(copy=True)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return pd.Series(0.5, index=series.index)
    span = float(finite.max() - finite.min())
    if span == 0:
        span = max(1.0, abs(float(finite.max())), abs(float(finite.min())))
    values[np.isposinf(values)] = float(finite.max()) + span
    values[np.isneginf(values)] = float(finite.min()) - span
    mn = float(values.min())
    mx = float(values.max())
    if mx == mn:
        normed = np.full_like(values, 0.5, dtype=np.float64)
    else:
        normed = (values - mn) / (mx - mn)
    if invert:
        normed = 1 - normed
    return pd.Series(normed, index=series.index)


def _to_rgba(color: str, alpha: float) -> str:
    """Convert any CSS color string to rgba(..., alpha). Handles hex and rgb()."""
    if color.startswith("#"):
        h = color.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return f"rgba({r},{g},{b},{alpha})"
    if color.startswith("rgba"):
        # Already has alpha — replace it
        return color.rsplit(",", 1)[0] + f",{alpha})"
    if color.startswith("rgb("):
        return color.replace("rgb(", "rgba(").replace(")", f",{alpha})")
    return f"rgba(128,128,128,{alpha})"


def _apply_dark_theme(fig) -> None:
    """Apply dark theme layout options in-place."""
    fig.update_layout(**_PLOTLY_LAYOUT)
    fig.update_xaxes(gridcolor="#222", zerolinecolor="#333")
    fig.update_yaxes(gridcolor="#222", zerolinecolor="#333")


def _fig_to_html(fig) -> str:
    """Convert a Plotly figure to an embeddable HTML fragment."""
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _score_groups(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """Compute median metrics plus normalized composite score for grouped rows."""
    score_metrics = [
        "price_accuracy",
        "convergence_speed",
        "mean_slippage",
        "lp_profitability",
        "manipulation_resistance",
        "resolution_fairness",
        "boundary_sensitivity_max",
        "exitability_unwind",
    ]
    available = [m for m in score_metrics if m in df.columns]
    grouped = df.groupby(group_cols)[available].median().reset_index()
    if grouped.empty:
        return grouped

    normalized = {
        "price_accuracy": _normalize_for_score(grouped["price_accuracy"], invert=True),
        "convergence_speed": _normalize_for_score(grouped["convergence_speed"], invert=True),
        "capital_efficiency": _normalize_for_score(grouped["mean_slippage"], invert=True),
        "lp_profitability": _normalize_for_score(grouped["lp_profitability"]),
        "manipulation_resistance": _normalize_for_score(grouped["manipulation_resistance"]),
        "resolution_fairness": _normalize_for_score(grouped["resolution_fairness"], invert=True),
        "boundary_sensitivity": _normalize_for_score(grouped["boundary_sensitivity_max"], invert=True),
        "exitability": _normalize_for_score(grouped["exitability_unwind"]),
    }
    grouped["composite_score"] = [
        composite_score({metric: float(series.iloc[idx]) for metric, series in normalized.items()})
        for idx in range(len(grouped))
    ]
    return grouped.sort_values("composite_score", ascending=False)


def _make_leaderboard(df: pd.DataFrame) -> str:
    """Build an HTML table showing per-design median [p5, p95] for each metric."""
    available = [m for m in _LEADERBOARD_METRICS if m in df.columns]
    grouped = df.groupby("design_name")[available]
    medians = grouped.median().reset_index()
    p5 = grouped.quantile(0.05).reset_index()
    p95 = grouped.quantile(0.95).reset_index()

    ranked = _score_groups(df, ["design_name"])[["design_name", "composite_score"]]
    medians = medians.merge(ranked, on="design_name", how="left")
    medians = medians.sort_values("composite_score", ascending=False)

    headers = ["Design", "Composite Score"] + [_METRIC_LABELS.get(m, m) for m in available]
    rows_html = ""
    for idx, row in medians.iterrows():
        dname = row["design_name"]
        cells = f'<td>{dname}</td>'
        cells += f"<td>{float(row['composite_score']):.4f}</td>"
        for m in available:
            val = row[m]
            p5_row = p5[p5["design_name"] == dname]
            p95_row = p95[p95["design_name"] == dname]
            lo = float(p5_row[m].iloc[0]) if len(p5_row) > 0 else val
            hi = float(p95_row[m].iloc[0]) if len(p95_row) > 0 else val
            if val == float("inf"):
                cells += "<td>&#8734;</td>"
            else:
                cells += f"<td>{val:.4f}<br/><small style='color:#666'>[{lo:.4f}, {hi:.4f}]</small></td>"
        rows_html += f"<tr>{cells}</tr>\n"

    header_html = "".join(f"<th>{h}</th>" for h in headers)
    return (
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )


def _make_metric_boxplot(df: pd.DataFrame, metric: str, title: str) -> str:
    """Return a Plotly boxplot HTML fragment for a single metric."""
    fig = px.box(
        df,
        x="design_name",
        y=metric,
        color="design_name",
        title=title,
        labels={"design_name": "Design", metric: _METRIC_LABELS.get(metric, metric)},
    )
    _apply_dark_theme(fig)
    fig.update_layout(showlegend=False)
    return _fig_to_html(fig)


def _make_baseline_chart(df: pd.DataFrame) -> str:
    """Boxplot comparing design indices 0 and 1 (Baseline A vs B) across all metrics."""
    subset = df[df["design"].isin([0, 1])].copy() if "design" in df.columns else df.copy()

    metric_cols = [m for m in _PHASE1_METRICS if m in subset.columns]
    melted = subset.melt(
        id_vars=["design_name"],
        value_vars=metric_cols,
        var_name="metric",
        value_name="value",
    )
    melted["metric_label"] = melted["metric"].map(
        lambda m: _METRIC_LABELS.get(m, m)
    )

    fig = px.box(
        melted,
        x="metric_label",
        y="value",
        color="design_name",
        title="Baseline A vs B \u2014 metric comparison",
        labels={"metric_label": "Metric", "value": "Value", "design_name": "Design"},
    )
    _apply_dark_theme(fig)
    return _fig_to_html(fig)


def _make_convergence_chart(df: pd.DataFrame) -> str:
    """KL divergence convergence curves: mean with p5/p95 bands per design."""
    if "kl_series" not in df.columns:
        return "<p style='color:#888'>No KL convergence data available.</p>"

    fig = go.Figure()
    designs = df["design_name"].unique()
    colors = px.colors.qualitative.Plotly

    for i, dname in enumerate(designs):
        subset = df[df["design_name"] == dname]
        # Collect all kl_series into a 2D array (runs x timesteps)
        series_list = [s for s in subset["kl_series"] if isinstance(s, (list, np.ndarray)) and len(s) > 0]
        if not series_list:
            continue
        max_len = max(len(s) for s in series_list)
        padded = np.full((len(series_list), max_len), np.nan)
        for j, s in enumerate(series_list):
            padded[j, :len(s)] = s

        mean_kl = np.nanmean(padded, axis=0)
        p5_kl = np.nanpercentile(padded, 5, axis=0)
        p95_kl = np.nanpercentile(padded, 95, axis=0)
        rounds = np.arange(max_len) * 10  # snapshot every 10 rounds

        color = colors[i % len(colors)]
        fill_color = _to_rgba(color, 0.1)
        fig.add_trace(go.Scatter(
            x=rounds, y=mean_kl, mode="lines", name=dname,
            line=dict(color=color),
        ))
        fig.add_trace(go.Scatter(
            x=np.concatenate([rounds, rounds[::-1]]),
            y=np.concatenate([p95_kl, p5_kl[::-1]]),
            fill="toself", fillcolor=fill_color,
            line=dict(width=0), showlegend=False, hoverinfo="skip",
        ))

    fig.update_layout(
        title="KL Divergence Convergence (mean \u00b1 p5/p95)",
        xaxis_title="Round",
        yaxis_title="KL Divergence",
        yaxis_type="log",
    )
    _apply_dark_theme(fig)
    return _fig_to_html(fig)


def _make_boundary_chart(df: pd.DataFrame) -> str:
    """Boxplot of boundary_sensitivity_max and boundary_sensitivity_mean per design."""
    bs_cols = [c for c in ("boundary_sensitivity_max", "boundary_sensitivity_mean") if c in df.columns]
    if not bs_cols:
        return "<p style='color:#888'>No boundary sensitivity data available.</p>"

    melted = df.melt(
        id_vars=["design_name"],
        value_vars=bs_cols,
        var_name="metric",
        value_name="value",
    )
    melted["metric_label"] = melted["metric"].map(
        lambda m: _METRIC_LABELS.get(m, m)
    )

    fig = px.box(
        melted,
        x="design_name",
        y="value",
        color="metric_label",
        title="Boundary Sensitivity by Design",
        labels={"design_name": "Design", "value": "Jump Size", "metric_label": "Metric"},
    )
    _apply_dark_theme(fig)
    return _fig_to_html(fig)


def _make_fairness_heatmap(df: pd.DataFrame) -> str:
    """Heatmap: payout ratio (actual/ideal) by distance from resolved bin, per design."""
    if "payout_by_distance" not in df.columns:
        return ""

    designs = df["design_name"].unique()
    max_dist = 10  # show first 10 distance bins
    matrix = []
    y_labels = []

    for dname in designs:
        subset = df[df["design_name"] == dname]
        avg_ratios = np.zeros(max_dist)
        counts = np.zeros(max_dist)
        for pbd in subset["payout_by_distance"]:
            if not isinstance(pbd, dict):
                continue
            for d_str, ratio in pbd.items():
                d = int(d_str) if isinstance(d_str, str) else d_str
                if 0 <= d < max_dist:
                    avg_ratios[d] += ratio
                    counts[d] += 1
        with np.errstate(invalid="ignore"):
            avg_ratios = np.where(counts > 0, avg_ratios / counts, 0)
        matrix.append(avg_ratios)
        y_labels.append(dname)

    if not matrix:
        return ""

    fig = go.Figure(data=go.Heatmap(
        z=matrix,
        x=[str(d) for d in range(max_dist)],
        y=y_labels,
        colorscale="RdYlGn",
        zmid=1.0,
        text=[[f"{v:.2f}" for v in row] for row in matrix],
        texttemplate="%{text}",
        hovertemplate="Design: %{y}<br>Distance: %{x}<br>Payout Ratio: %{z:.3f}<extra></extra>",
    ))
    fig.update_layout(
        title="Payout Ratio by Distance from Resolved Bin",
        xaxis_title="Distance (bins from resolved)",
        yaxis_title="Design",
    )
    _apply_dark_theme(fig)
    return _fig_to_html(fig)


def _make_exitability_chart(df: pd.DataFrame) -> str:
    """Boxplot comparing exitability_unwind and exitability_slippage per design."""
    exit_cols = [c for c in ("exitability_unwind", "exitability_slippage") if c in df.columns]
    if not exit_cols:
        return "<p style='color:#888'>No exitability data available.</p>"

    melted = df.melt(
        id_vars=["design_name"],
        value_vars=exit_cols,
        var_name="metric",
        value_name="value",
    )
    melted["metric_label"] = melted["metric"].map(
        lambda m: _METRIC_LABELS.get(m, m)
    )

    fig = px.box(
        melted,
        x="design_name",
        y="value",
        color="metric_label",
        title="Exitability by Design",
        labels={"design_name": "Design", "value": "Value", "metric_label": "Metric"},
    )
    _apply_dark_theme(fig)
    return _fig_to_html(fig)


def _make_clob_section(phase1_df: pd.DataFrame, clob_df: pd.DataFrame | None) -> str:
    """Build a qualitative comparison table: CLOB vs top AMM designs."""
    if clob_df is None or clob_df.empty:
        return ""

    available = [m for m in _LEADERBOARD_METRICS if m in phase1_df.columns and m in clob_df.columns]
    if not available:
        return "<p style='color:#888'>No comparable metrics available.</p>"

    # Get top 3 AMM designs by median resolution_fairness
    amm_medians = phase1_df.groupby("design_name")[available].median().reset_index()
    if "resolution_fairness" in amm_medians.columns:
        amm_medians = amm_medians.sort_values("resolution_fairness")
    top_amm = amm_medians.head(3)

    clob_medians = clob_df[available].median()

    headers = ["Metric"] + list(top_amm["design_name"]) + ["CLOB Hybrid"]
    header_html = "".join(f"<th>{h}</th>" for h in headers)

    rows_html = ""
    for m in available:
        label = _METRIC_LABELS.get(m, m)
        cells = f"<td>{label}</td>"
        for _, row in top_amm.iterrows():
            val = row[m]
            cells += f"<td>{val:.4f}</td>" if val != float("inf") else "<td>&#8734;</td>"
        clob_val = clob_medians[m]
        cells += f"<td>{clob_val:.4f}</td>" if clob_val != float("inf") else "<td>&#8734;</td>"
        rows_html += f"<tr>{cells}</tr>\n"

    # CLOB-specific metrics table
    clob_metrics = ["clob_fill_rate", "clob_avg_spread", "clob_total_depth", "clob_fill_volume"]
    clob_labels = {
        "clob_fill_rate": "Fill Rate",
        "clob_avg_spread": "Avg Bid-Ask Spread",
        "clob_total_depth": "Total Resting Depth",
        "clob_fill_volume": "Total Fill Volume",
    }
    clob_avail = [m for m in clob_metrics if m in clob_df.columns]
    clob_specific_html = ""
    if clob_avail:
        clob_specific_html = "<h3>CLOB-Specific Metrics</h3>"
        ch = "<th>Metric</th><th>Median</th><th>p5</th><th>p95</th>"
        cr = ""
        for m in clob_avail:
            med = clob_df[m].median()
            lo = clob_df[m].quantile(0.05)
            hi = clob_df[m].quantile(0.95)
            cr += f"<tr><td>{clob_labels.get(m, m)}</td><td>{med:.4f}</td><td>{lo:.4f}</td><td>{hi:.4f}</td></tr>\n"
        clob_specific_html += f"<table><thead><tr>{ch}</tr></thead><tbody>{cr}</tbody></table>"

    return (
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
        f"{clob_specific_html}"
        f"<p class='section-note'>CLOB uses orderbook-based price discovery with piecewise-linear settlement. "
        f"Direct composite score comparison with AMM designs is not meaningful due to "
        f"fundamentally different microstructure.</p>"
    )


def _make_phase2_charts(phase2_df: pd.DataFrame) -> list[tuple[str, str]]:
    """Build one boxplot per Phase-1 metric, x=fee_name, color=design_name."""
    charts = []
    for metric in _PHASE1_METRICS:
        if metric not in phase2_df.columns:
            continue
        label = _METRIC_LABELS.get(metric, metric)
        fig = px.box(
            phase2_df,
            x="fee_name",
            y=metric,
            color="design_name",
            title=f"{label} \u2014 Fee Model Breakdown",
            labels={
                "fee_name": "Fee Model",
                metric: label,
                "design_name": "Design",
            },
        )
        _apply_dark_theme(fig)
        charts.append((f"{label} by Fee Model", _fig_to_html(fig)))
    return charts


def _make_fee_heatmaps(phase2_df: pd.DataFrame) -> list[tuple[str, str]]:
    """Build one heatmap per metric: designs (y) x fee models (x), color = median metric."""
    heatmaps = []
    metrics = [m for m in _LEADERBOARD_METRICS if m in phase2_df.columns]

    for metric in metrics:
        label = _METRIC_LABELS.get(metric, metric)
        pivot = phase2_df.groupby(["design_name", "fee_name"])[metric].median().reset_index()
        pivot_wide = pivot.pivot(index="design_name", columns="fee_name", values=metric)

        fig = go.Figure(data=go.Heatmap(
            z=pivot_wide.values,
            x=list(pivot_wide.columns),
            y=list(pivot_wide.index),
            colorscale="Viridis",
            text=[[f"{v:.4f}" if not np.isnan(v) and v != float("inf") else "" for v in row] for row in pivot_wide.values],
            texttemplate="%{text}",
            hovertemplate="Design: %{y}<br>Fee: %{x}<br>Value: %{z:.4f}<extra></extra>",
        ))
        fig.update_layout(
            title=f"{label} \u2014 Design \u00d7 Fee Heatmap",
            xaxis_title="Fee Model",
            yaxis_title="Design",
        )
        _apply_dark_theme(fig)
        heatmaps.append((f"{label} Heatmap", _fig_to_html(fig)))

    return heatmaps


def _make_sensitivity_charts(sens_df: pd.DataFrame) -> list[tuple[str, str]]:
    """Build boxplots for each sensitivity parameter: bins, liquidity, agent_mix."""
    charts = []
    metric = "price_accuracy"  # primary metric to show sensitivity

    for param in ["num_bins", "liquidity", "agent_mix"]:
        subset = sens_df[sens_df["sweep_param"] == param]
        if subset.empty or metric not in subset.columns:
            continue
        subset = subset.copy()
        subset["sweep_value"] = subset["sweep_value"].astype(str)

        fig = px.box(
            subset,
            x="sweep_value",
            y=metric,
            color="design_name",
            title=f"Price Accuracy (KL) vs {param}",
            labels={
                "sweep_value": param,
                metric: _METRIC_LABELS.get(metric, metric),
                "design_name": "Design",
            },
        )
        _apply_dark_theme(fig)
        charts.append((f"Sensitivity: {param}", _fig_to_html(fig)))

        # Also show resolution fairness
        if "resolution_fairness" in subset.columns:
            fig2 = px.box(
                subset,
                x="sweep_value",
                y="resolution_fairness",
                color="design_name",
                title=f"Resolution Fairness vs {param}",
                labels={
                    "sweep_value": param,
                    "resolution_fairness": _METRIC_LABELS.get("resolution_fairness", "Resolution Fairness"),
                    "design_name": "Design",
                },
            )
            _apply_dark_theme(fig2)
            charts.append((f"Fairness Sensitivity: {param}", _fig_to_html(fig2)))

    return charts


def _make_optimal_fee_table(phase2_df: pd.DataFrame) -> str:
    """Identify the best fee mechanism per design using composite-like ranking.

    For each design, pick the fee model with the best median across key metrics
    (lower price_accuracy/resolution_fairness, higher lp_profitability).
    """
    if phase2_df.empty:
        return ""

    # Score each (design, fee) combo: lower is better for this simple ranking
    score_cols = []
    if "price_accuracy" in phase2_df.columns:
        score_cols.append(("price_accuracy", True))   # lower is better
    if "resolution_fairness" in phase2_df.columns:
        score_cols.append(("resolution_fairness", True))
    if "lp_profitability" in phase2_df.columns:
        score_cols.append(("lp_profitability", False))  # higher is better

    if not score_cols:
        return ""

    grouped = phase2_df.groupby(["design_name", "fee_name"])
    medians = grouped[[c for c, _ in score_cols]].median().reset_index()

    # Normalize and compute simple score per (design, fee)
    for col, lower_better in score_cols:
        mn, mx = medians[col].min(), medians[col].max()
        if mx > mn:
            normed = (medians[col] - mn) / (mx - mn)
            medians[col + "_norm"] = (1 - normed) if lower_better else normed
        else:
            medians[col + "_norm"] = 0.5

    norm_cols = [c + "_norm" for c, _ in score_cols]
    medians["score"] = medians[norm_cols].mean(axis=1)

    # Pick best fee per design
    best = medians.loc[medians.groupby("design_name")["score"].idxmax()]

    headers = ["Design", "Optimal Fee", "Score"]
    header_html = "".join(f"<th>{h}</th>" for h in headers)
    rows_html = ""
    for _, row in best.iterrows():
        rows_html += (
            f'<tr><td>{row["design_name"]}</td>'
            f'<td><span class="badge">{row["fee_name"]}</span></td>'
            f'<td>{row["score"]:.4f}</td></tr>\n'
        )

    return (
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )


def _make_stage0_html(stage0: dict) -> str:
    """Build an HTML table showing Stage 0 validity gate results."""
    results = stage0.get("validity_results", [])
    if not results:
        return ""

    header_html = "<th>Gate</th><th>Status</th><th>Detail</th>"
    rows_html = ""
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        badge_style = 'background: #1f3a2a; color: #4caf50;' if r.passed else 'background: #3a1f1f; color: #f44336;'
        rows_html += (
            f'<tr><td>{r.gate}</td>'
            f'<td><span class="badge" style="{badge_style}">{status}</span></td>'
            f'<td>{r.detail}</td></tr>\n'
        )

    return (
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )


def _make_pareto_html(stage1_df: pd.DataFrame) -> str:
    """Identify designs on the Pareto front from Stage 1 data."""
    # Filter out CLOB for Pareto analysis
    amm_df = stage1_df[stage1_df.get("design", pd.Series(dtype=int)) != DESIGN_CLOB].copy() if "design" in stage1_df.columns else stage1_df.copy()

    scored = _score_groups(amm_df, ["design_name"])
    if scored.empty:
        return ""

    # Simple Pareto: for each design, check if it's dominated (another design
    # is better on ALL of: price_accuracy (lower), lp_profitability (higher),
    # resolution_fairness (lower))
    pareto_metrics = {
        "price_accuracy": True,   # lower is better
        "lp_profitability": False,  # higher is better
        "resolution_fairness": True,  # lower is better
    }
    available_pareto = {m: inv for m, inv in pareto_metrics.items() if m in scored.columns}

    pareto_designs = []
    for i, row_i in scored.iterrows():
        dominated = False
        for j, row_j in scored.iterrows():
            if i == j:
                continue
            all_better = True
            for m, lower_better in available_pareto.items():
                if lower_better:
                    if row_j[m] >= row_i[m]:
                        all_better = False
                        break
                else:
                    if row_j[m] <= row_i[m]:
                        all_better = False
                        break
            if all_better:
                dominated = True
                break
        pareto_designs.append(not dominated)

    header_html = "<th>Design</th><th>Composite Score</th><th>Pareto Front</th>"
    rows_html = ""
    for idx, (_, row) in enumerate(scored.iterrows()):
        on_front = pareto_designs[idx]
        badge = '<span class="badge">On Front</span>' if on_front else '<span style="color: #888;">Dominated</span>'
        rows_html += (
            f'<tr><td>{row["design_name"]}</td>'
            f'<td>{row["composite_score"]:.4f}</td>'
            f'<td>{badge}</td></tr>\n'
        )

    return (
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )


def _make_scalar_redteam_html(stage1_df: pd.DataFrame) -> str:
    """Build a section isolating the Scalar design for red-team review."""
    if "design" not in stage1_df.columns:
        return ""

    scalar_df = stage1_df[stage1_df["design"] == DESIGN_SCALAR].copy()
    if scalar_df.empty:
        return ""

    scalar_name = DESIGN_NAMES[DESIGN_SCALAR]
    metrics = [m for m in _LEADERBOARD_METRICS if m in scalar_df.columns]
    # Also include new metrics
    extra = ["truthful_incentive_alignment", "boundary_payout_jump_max", "boundary_incentive_jump_max",
             "lp_activation_rate"]
    metrics.extend([m for m in extra if m in scalar_df.columns and m not in metrics])

    if not metrics:
        return ""

    header_html = "<th>Metric</th><th>Median</th><th>p5</th><th>p95</th>"
    rows_html = ""
    for m in metrics:
        med = scalar_df[m].median()
        lo = scalar_df[m].quantile(0.05)
        hi = scalar_df[m].quantile(0.95)
        label = _METRIC_LABELS.get(m, m)
        if med == float("inf"):
            rows_html += f"<tr><td>{label}</td><td>&#8734;</td><td>&#8734;</td><td>&#8734;</td></tr>\n"
        else:
            rows_html += f"<tr><td>{label}</td><td>{med:.4f}</td><td>{lo:.4f}</td><td>{hi:.4f}</td></tr>\n"

    return (
        f'<p style="color: #f44336; font-weight: bold;">Red-Team Only: {scalar_name}</p>'
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )


def _make_tia_chart(df: pd.DataFrame) -> str:
    """Boxplot of truthful_incentive_alignment scores by design."""
    if "truthful_incentive_alignment" not in df.columns:
        return ""

    fig = px.box(
        df,
        x="design_name",
        y="truthful_incentive_alignment",
        color="design_name",
        title="Truthful Incentive Alignment by Design",
        labels={
            "design_name": "Design",
            "truthful_incentive_alignment": _METRIC_LABELS.get(
                "truthful_incentive_alignment", "TIA"
            ),
        },
    )
    _apply_dark_theme(fig)
    fig.update_layout(showlegend=False)
    return _fig_to_html(fig)


def _make_lp_activation_html(df: pd.DataFrame) -> str:
    """Table showing LP activation rate and deploy status per design."""
    if "lp_activation_rate" not in df.columns:
        return ""

    cols = ["lp_activation_rate"]
    if "lp_deploy_status" in df.columns:
        cols.append("lp_deploy_status")

    designs = df["design_name"].unique()
    header_cells = "<th>Design</th><th>Median Activation Rate</th>"
    if "lp_deploy_status" in df.columns:
        header_cells += "<th>Deploy Status (mode)</th>"
    header_html = header_cells

    rows_html = ""
    for dname in designs:
        subset = df[df["design_name"] == dname]
        rate = subset["lp_activation_rate"].median()
        cells = f"<td>{dname}</td><td>{rate:.4f}</td>"
        if "lp_deploy_status" in df.columns:
            # Mode of deploy status
            mode = subset["lp_deploy_status"].mode()
            status_str = str(mode.iloc[0]) if len(mode) > 0 else "N/A"
            cells += f"<td>{status_str}</td>"
        rows_html += f"<tr>{cells}</tr>\n"

    return (
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )


def _make_boundary_revised_chart(df: pd.DataFrame) -> str:
    """Boxplot showing payout_jump and incentive_jump metrics per design."""
    revised_cols = [c for c in (
        "boundary_payout_jump_max", "boundary_payout_jump_mean",
        "boundary_incentive_jump_max", "boundary_incentive_jump_mean",
    ) if c in df.columns]

    if not revised_cols:
        return ""

    melted = df.melt(
        id_vars=["design_name"],
        value_vars=revised_cols,
        var_name="metric",
        value_name="value",
    )
    melted["metric_label"] = melted["metric"].map(
        lambda m: _METRIC_LABELS.get(m, m)
    )

    fig = px.box(
        melted,
        x="design_name",
        y="value",
        color="metric_label",
        title="Revised Boundary Sensitivity: Payout + Incentive Jumps",
        labels={"design_name": "Design", "value": "Jump Size", "metric_label": "Metric"},
    )
    _apply_dark_theme(fig)
    return _fig_to_html(fig)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_report(
    stage1_df: pd.DataFrame,
    stage2_df: pd.DataFrame | None = None,
    stage3_df: pd.DataFrame | None = None,
    output_dir: str = "output",
    stage0: dict | None = None,
    finalists: list[int] | None = None,
    # Backward-compatible aliases (deprecated)
    phase2_df: pd.DataFrame | None = None,
    clob_df: pd.DataFrame | None = None,
    sensitivity_df: pd.DataFrame | None = None,
) -> str:
    """Generate a standalone HTML report and write it to output_dir/report.html.

    Parameters
    ----------
    stage1_df:
        DataFrame produced by sweeps.run_stage1(). Contains ALL designs
        including CLOB. Filter by design != DESIGN_CLOB for AMM sections.
    stage2_df:
        Optional DataFrame produced by sweeps.run_stage2() (fee sweep).
    stage3_df:
        Optional DataFrame produced by sweeps.run_stage3() (sensitivity).
    output_dir:
        Directory to write report.html.
    stage0:
        Optional dict from run_stage0() with validity_results.
    finalists:
        Optional list of finalist design IDs.
    phase2_df:
        Deprecated alias for stage2_df (backward compatibility).
    clob_df:
        Deprecated. CLOB data is now included in stage1_df.
    sensitivity_df:
        Deprecated alias for stage3_df (backward compatibility).

    Returns
    -------
    str
        Absolute path to the generated report.html file.
    """
    # Handle backward-compatible parameters
    if stage2_df is None and phase2_df is not None:
        stage2_df = phase2_df
    if stage3_df is None and sensitivity_df is not None:
        stage3_df = sensitivity_df

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Separate AMM data and CLOB data from stage1_df
    if "design" in stage1_df.columns:
        amm_df = stage1_df[stage1_df["design"] != DESIGN_CLOB].copy()
        clob_data = stage1_df[stage1_df["design"] == DESIGN_CLOB].copy()
    else:
        amm_df = stage1_df.copy()
        clob_data = clob_df  # fall back to explicit clob_df if no design column

    # --- Stage 0: Validity Gates ---
    stage0_html = _make_stage0_html(stage0) if stage0 is not None else ""

    # --- Build individual sections ---
    leaderboard_html = _make_leaderboard(amm_df)
    pareto_html = _make_pareto_html(amm_df)
    baseline_chart = _make_baseline_chart(amm_df)

    metric_charts = []
    for metric in _PHASE1_METRICS:
        if metric not in amm_df.columns:
            continue
        label = _METRIC_LABELS.get(metric, metric)
        html_frag = _make_metric_boxplot(amm_df, metric, f"{label} by Design")
        metric_charts.append((f"{label} Distribution", html_frag))

    # Truthful Incentive Alignment
    tia_chart = _make_tia_chart(amm_df)

    # LP Activation
    lp_activation_html = _make_lp_activation_html(amm_df)

    convergence_chart = _make_convergence_chart(amm_df)
    boundary_chart = _make_boundary_chart(amm_df)
    boundary_revised_chart = _make_boundary_revised_chart(amm_df)
    fairness_heatmap = _make_fairness_heatmap(amm_df)
    exitability_chart = _make_exitability_chart(amm_df)

    # Scalar Red-Team section
    scalar_redteam_html = _make_scalar_redteam_html(stage1_df)

    # CLOB section
    clob_section = _make_clob_section(amm_df, clob_data if clob_data is not None and len(clob_data) > 0 else None)

    phase2_charts = _make_phase2_charts(stage2_df) if stage2_df is not None else []
    fee_heatmaps = _make_fee_heatmaps(stage2_df) if stage2_df is not None else []
    optimal_fee_html = _make_optimal_fee_table(stage2_df) if stage2_df is not None else ""
    sensitivity_charts = _make_sensitivity_charts(stage3_df) if stage3_df is not None else []

    # --- Render HTML ---
    html = _HTML_TEMPLATE.render(
        plotly_js=_PLOTLY_JS,
        stage0_html=stage0_html,
        leaderboard_html=leaderboard_html,
        pareto_html=pareto_html,
        baseline_chart=baseline_chart,
        metric_charts=metric_charts,
        tia_chart=tia_chart,
        lp_activation_html=lp_activation_html,
        convergence_chart=convergence_chart,
        boundary_chart=boundary_chart,
        boundary_revised_chart=boundary_revised_chart,
        fairness_heatmap=fairness_heatmap,
        exitability_chart=exitability_chart,
        scalar_redteam_html=scalar_redteam_html,
        clob_section=clob_section,
        phase2_charts=phase2_charts,
        fee_heatmaps=fee_heatmaps,
        optimal_fee_html=optimal_fee_html,
        sensitivity_charts=sensitivity_charts,
        has_sensitivity=stage3_df is not None and not stage3_df.empty,
        has_phase2=stage2_df is not None and not stage2_df.empty,
    )

    report_path = out / "report.html"
    report_path.write_text(html, encoding="utf-8")
    return str(report_path.resolve())
