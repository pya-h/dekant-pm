"""Generate a standalone HTML report with Plotly charts for simulation results.

Usage:
    from analysis.report import generate_report
    path = generate_report(phase1_df, phase2_df=phase2_df, output_dir="output")
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.express as px
from jinja2 import Template

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PLOTLY_CDN = "https://cdn.plot.ly/plotly-latest.min.js"

_PHASE1_METRICS = [
    "price_accuracy",
    "convergence_speed",
    "lp_profitability",
    "resolution_fairness",
    "exitability_unwind",
]

_LEADERBOARD_METRICS = [
    "price_accuracy",
    "convergence_speed",
    "lp_profitability",
    "manipulation_resistance",
    "resolution_fairness",
    "boundary_sensitivity_max",
    "exitability_unwind",
]

_METRIC_LABELS = {
    "price_accuracy": "Price Accuracy (KL↓)",
    "convergence_speed": "Convergence Speed (rounds↓)",
    "lp_profitability": "LP Profitability↑",
    "manipulation_resistance": "Manipulation Resistance↑",
    "resolution_fairness": "Resolution Fairness (err↓)",
    "boundary_sensitivity_max": "Boundary Sensitivity Max↓",
    "boundary_sensitivity_mean": "Boundary Sensitivity Mean↓",
    "exitability_unwind": "Exitability Unwind↑",
    "exitability_slippage": "Exitability Slippage↓",
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
  <script src="{{ plotly_cdn }}"></script>
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
  </style>
</head>
<body>
  <h1>DekantPM Simulation Report</h1>
  <p class="subtitle">AMM settlement design evaluation — quantitative analysis output</p>

  <h2>Leaderboard</h2>
  {{ leaderboard_html }}

  <h2>Baseline A vs B Comparison</h2>
  <div class="chart-container">{{ baseline_chart }}</div>

  {% for title, chart in metric_charts %}
  <h2>{{ title }}</h2>
  <div class="chart-container">{{ chart }}</div>
  {% endfor %}

  <h2>Boundary Sensitivity</h2>
  <div class="chart-container">{{ boundary_chart }}</div>

  {% if phase2_charts %}
  <h2>Phase 2: Fee Model Comparison</h2>
  {% for title, chart in phase2_charts %}
  <h3 style="color:#aaa; margin: 1.5rem 0 0.5rem; font-size:1rem;">{{ title }}</h3>
  <div class="chart-container">{{ chart }}</div>
  {% endfor %}
  {% endif %}
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


def _apply_dark_theme(fig) -> None:
    """Apply dark theme layout options in-place."""
    fig.update_layout(**_PLOTLY_LAYOUT)
    fig.update_xaxes(gridcolor="#222", zerolinecolor="#333")
    fig.update_yaxes(gridcolor="#222", zerolinecolor="#333")


def _fig_to_html(fig) -> str:
    """Convert a Plotly figure to an embeddable HTML fragment."""
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _make_leaderboard(df: pd.DataFrame) -> str:
    """Build an HTML table showing per-design median for each metric."""
    available = [m for m in _LEADERBOARD_METRICS if m in df.columns]
    agg = df.groupby("design_name")[available].median().reset_index()
    agg = agg.sort_values(
        "resolution_fairness" if "resolution_fairness" in agg.columns else available[0]
    )

    headers = ["Design"] + [_METRIC_LABELS.get(m, m) for m in available]
    rows_html = ""
    for _, row in agg.iterrows():
        cells = f'<td>{row["design_name"]}</td>'
        for m in available:
            val = row[m]
            # Infinity (manipulation_resistance can be inf) → display as ∞
            if val == float("inf"):
                cells += "<td>&#8734;</td>"
            else:
                cells += f"<td>{val:.4f}</td>"
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

    # Melt to long form for a multi-metric grouped boxplot
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
        title="Baseline A vs B — metric comparison",
        labels={"metric_label": "Metric", "value": "Value", "design_name": "Design"},
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
            title=f"{label} — Fee Model Breakdown",
            labels={
                "fee_name": "Fee Model",
                metric: label,
                "design_name": "Design",
            },
        )
        _apply_dark_theme(fig)
        charts.append((f"{label} by Fee Model", _fig_to_html(fig)))
    return charts


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_report(
    phase1_df: pd.DataFrame,
    phase2_df: pd.DataFrame | None = None,
    output_dir: str = "output",
) -> str:
    """Generate a standalone HTML report and write it to output_dir/report.html.

    Parameters
    ----------
    phase1_df:
        DataFrame produced by sweeps.run_phase1().
    phase2_df:
        Optional DataFrame produced by sweeps.run_phase2().  When supplied,
        Phase-2 fee-model charts are included in the report.
    output_dir:
        Directory to write report.html (created if it does not exist).

    Returns
    -------
    str
        Absolute path to the generated report.html file.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # --- Build individual sections ---
    leaderboard_html = _make_leaderboard(phase1_df)
    baseline_chart = _make_baseline_chart(phase1_df)

    metric_charts = []
    for metric in _PHASE1_METRICS:
        if metric not in phase1_df.columns:
            continue
        label = _METRIC_LABELS.get(metric, metric)
        html_frag = _make_metric_boxplot(phase1_df, metric, f"{label} by Design")
        metric_charts.append((f"{label} Distribution", html_frag))

    boundary_chart = _make_boundary_chart(phase1_df)

    phase2_charts = _make_phase2_charts(phase2_df) if phase2_df is not None else []

    # --- Render HTML ---
    html = _HTML_TEMPLATE.render(
        plotly_cdn=_PLOTLY_CDN,
        leaderboard_html=leaderboard_html,
        baseline_chart=baseline_chart,
        metric_charts=metric_charts,
        boundary_chart=boundary_chart,
        phase2_charts=phase2_charts,
    )

    report_path = out / "report.html"
    report_path.write_text(html, encoding="utf-8")
    return str(report_path.resolve())
