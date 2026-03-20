import type {
  AdminDashboardBreakdownItem,
  AdminDashboardChartCard,
  AdminDashboardDetailData,
  AdminDashboardKind,
  AdminDashboardListItem,
  AdminDashboardStat,
  AdminDashboardTimelinePoint,
} from "app-types/admin-dashboard";

const RESOURCE_LABELS: Record<AdminDashboardKind, string> = {
  agent: "agents",
  mcp: "servers",
  contextx: "contexts",
  skill: "skills",
  workflow: "workflows",
};

function sortBreakdownItems(items: AdminDashboardBreakdownItem[]) {
  return [...items].sort((left, right) => {
    if (right.value !== left.value) {
      return right.value - left.value;
    }

    return left.label.localeCompare(right.label);
  });
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

export function summarizeAdminDashboardTimeline(
  timeline: AdminDashboardTimelinePoint[],
) {
  const total = timeline.reduce((sum, point) => sum + point.value, 0);
  const activeDays = timeline.filter((point) => point.value > 0).length;
  const peakDay = [...timeline].sort((left, right) => {
    if (right.value !== left.value) {
      return right.value - left.value;
    }

    return left.date.localeCompare(right.date);
  })[0];

  return {
    total,
    activeDays,
    averagePerDay: timeline.length > 0 ? total / timeline.length : 0,
    averagePerActiveDay: activeDays > 0 ? total / activeDays : 0,
    peakDay,
  };
}

export function buildAdminDashboardListCharts(
  kind: AdminDashboardKind,
  items: AdminDashboardListItem[],
): AdminDashboardChartCard[] {
  const topUsageItems = sortBreakdownItems(
    items.map((item) => ({
      label: item.name,
      secondary: item.meta ?? item.creatorName,
      value: item.totalUsage,
    })),
  ).slice(0, 6);

  const creatorHasUsage = items.some((item) => item.totalUsage > 0);
  const creatorMap = new Map<
    string,
    { label: string; secondary?: string; value: number }
  >();

  for (const item of items) {
    const existing = creatorMap.get(item.creatorId);
    const nextValue = creatorHasUsage ? item.totalUsage : 1;
    if (existing) {
      existing.value += nextValue;
      continue;
    }

    creatorMap.set(item.creatorId, {
      label: item.creatorName,
      secondary: item.creatorEmail,
      value: nextValue,
    });
  }

  const creatorItems = sortBreakdownItems(
    Array.from(creatorMap.values()),
  ).slice(0, 6);

  const activeCount = items.filter((item) => item.totalUsage > 0).length;
  const inactiveCount = Math.max(items.length - activeCount, 0);

  return [
    {
      title: `Top ${RESOURCE_LABELS[kind]} by usage`,
      description: "Highest activity across the current filtered range.",
      type: "bar",
      valueLabel: "Usage",
      items: topUsageItems,
    },
    {
      title: creatorHasUsage ? "Usage by creator" : "Resources by creator",
      description: creatorHasUsage
        ? "Which owners are driving the most activity."
        : "How ownership is distributed in this result set.",
      type: "donut",
      valueLabel: creatorHasUsage ? "Usage" : "Resources",
      items: creatorItems,
    },
    {
      title: "Activity coverage",
      description: "Share of resources with at least one event in the range.",
      type: "donut",
      valueLabel: "Resources",
      items: [
        { label: "Active", value: activeCount },
        { label: "No activity", value: inactiveCount },
      ],
    },
  ];
}

export function buildAdminDashboardDetailInsights(
  data: AdminDashboardDetailData,
): AdminDashboardStat[] {
  const timeline = summarizeAdminDashboardTimeline(data.usageTimeline);
  const dominantBreakdown = data.breakdowns
    .map((section) => {
      const total = section.items.reduce((sum, item) => sum + item.value, 0);
      const topItem = sortBreakdownItems(section.items)[0];

      if (!topItem || total === 0) {
        return null;
      }

      return {
        label: topItem.label,
        sectionTitle: section.title,
        share: Math.round((topItem.value / total) * 100),
      };
    })
    .find(Boolean);
  const leadingTopList = data.topLists
    .map((section) => {
      const first = sortBreakdownItems(section.items)[0];
      if (!first) {
        return null;
      }

      return {
        title: section.title,
        item: first,
      };
    })
    .find(Boolean);

  return [
    {
      label: "Peak day",
      value: timeline.peakDay?.value ?? 0,
      hint: timeline.peakDay
        ? `${formatShortDate(timeline.peakDay.date)}`
        : "No activity in range",
    },
    {
      label: "Active days",
      value: timeline.activeDays,
      hint: `${timeline.activeDays}/${data.usageTimeline.length || 0} days with usage`,
    },
    {
      label: "Daily average",
      value: Math.round(timeline.averagePerDay),
      hint:
        timeline.activeDays > 0
          ? `${Math.round(timeline.averagePerActiveDay)} per active day`
          : "No active days yet",
    },
    {
      label: dominantBreakdown ? "Dominant segment" : "Leading entity",
      value: dominantBreakdown ? `${dominantBreakdown.share}%` : 0,
      hint: dominantBreakdown
        ? `${dominantBreakdown.label} in ${dominantBreakdown.sectionTitle}`
        : leadingTopList
          ? `${leadingTopList.item.label} in ${leadingTopList.title}`
          : "No ranking data available",
    },
  ];
}
