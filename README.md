# Interactive Cluster-Wide Usage Visualization

An interactive web page showing who used the REPACSS cluster in June 2026 and how busy each
machine was, hour by hour. It covers 37 users on 118 machines: 110 Zen4 CPU nodes and 8 H100
GPU nodes, each with 4 NVIDIA H100 GPUs. Picking a user, from the row of names, a network
chart or the Timearcs, highlights them across the charts and the heatmap.

**▶ [Open the app](https://idatavisualizationlab.github.io/Interactive-Cluster-Wide-Usage-Visualization-Public/cluster_usage_user_node_time.html)**, then upload the data zip on its lock screen.

## What it contains

**The chart box at the top**, one tab at a time:

| Tab | Chart |
|---|---|
| Summarization | Key numbers for the month; ranking bar charts of CPU devices, GPU devices, users and busiest days; hours used per day |
| Timearcs | Arcs from each user to the machine groups they used, day by day |
| Network Chart by Hour | Network graph of who held which machine in one hour, with a time slider |
| Network Chart by Month (Users & Groups) | Layered graph with alternating rows of users and machine groups, arranged to reduce line crossings |
| Network Chart by Month (original) | The same network graph for the whole month |
| Network Chart by Month | Circular network graphs of the month: Original, Reallocation and 3 rings (users, machine groups, machines) |
| Users & Groups | Layered graph: users above and below a row of machine groups |


**Below it, the Usage Heatmap:** one row per machine and user pair, one column per hour,
coloured by CPU or GPU usage. The rows can be grouped by node or by user, sorted, and
expanded or collapsed.

## How to open it

1. Open the page:
   - **online:** go to
     https://idatavisualizationlab.github.io/Interactive-Cluster-Wide-Usage-Visualization-Public/cluster_usage_user_node_time.html
   - **or from a copy of this repo:** double-click **`cluster_usage_user_node_time.html`**, or
     double-click **`serve.bat`** (needs Python 3), which opens it at
     `http://localhost:8000/cluster_usage_user_node_time.html`.
2. The page opens on a lock screen. Upload the input data there: one **.zip** holding the two
   metric files (the h100 and the zen4 file). Click **Upload data (.zip)**, or drop the zip
   onto the screen. The data is not in this repo; the zip is shared separately.

The zip is opened and converted in your browser; nothing is uploaded to a server or saved.
An internet connection is needed for the two libraries the page uses (Plotly and fflate).
