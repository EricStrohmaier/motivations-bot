export function parseGoalAndDeadline(text: string): {
  goalText: string;
  deadline: Date | undefined;
} {
  // Common deadline indicators
  const deadlineKeywords = ["by", "until", "before", "deadline", "due"];
  const text_lower = text.toLowerCase();

  // Try to find natural language dates
  const today = new Date();
  let deadline: Date | undefined = undefined;
  let goalText = text;

  // Check for "tomorrow"
  if (text_lower.includes("tomorrow")) {
    deadline = new Date(today);
    deadline.setDate(deadline.getDate() + 1);
    goalText = text.replace(/tomorrow/gi, "").trim();
  }

  // Check for specific date formats (e.g., "by MM/DD" or "deadline MM/DD/YYYY")
  const dateRegex =
    /(?:by|until|before|deadline|due)?\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const parsedDate = new Date(dateStr);
    if (!isNaN(parsedDate.getTime())) {
      deadline = parsedDate;
      goalText = text.replace(dateRegex, "").trim();
    }
  }

  // Clean up the goal text
  deadlineKeywords.forEach((keyword) => {
    goalText = goalText.replace(new RegExp(keyword, "gi"), "").trim();
  });
  goalText = goalText.replace(/,\s*$/, "").trim(); // Remove trailing comma

  return { goalText, deadline };
}
