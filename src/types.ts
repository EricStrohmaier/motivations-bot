// src/types.ts
export interface UserProfile {
  userId: number;
  username: string;
  goals: Goal[];
  motivationFrequency: number;
  timezone: string; // Add timezone field
  lastMessageDate: Date;
  checkInEnabled: boolean;
  customMotivationMessages: string[];
}

interface Goal {
  text: string;
  priority: "high" | "medium" | "low";
  deadline?: Date;
  createdAt: Date;
}
