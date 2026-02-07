export enum TaskStatus {
  Todo = " ",
  Done = "x",
  InProgress = "/",
  Cancelled = "-",
}

export enum TaskPriority {
  Highest = "🔺",
  High = "⏫",
  Medium = "🔼",
  Normal = "",
  Low = "🔽",
  Lowest = "⏬",
}

export interface Task {
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  startDate?: string;
  scheduledDate?: string;
  createdDate?: string;
  doneDate?: string;
  recurrence?: string;
  tags?: string[];
}

const EMOJI_PATTERNS: Record<string, keyof Task> = {
  "📅": "dueDate",
  "🛫": "startDate",
  "⏳": "scheduledDate",
  "➕": "createdDate",
  "✅": "doneDate",
  "🔁": "recurrence",
};

const PRIORITY_EMOJIS = new Map<string, TaskPriority>([
  ["🔺", TaskPriority.Highest],
  ["⏫", TaskPriority.High],
  ["🔼", TaskPriority.Medium],
  ["🔽", TaskPriority.Low],
  ["⏬", TaskPriority.Lowest],
]);

export class TaskManager {
  /** Parse an Obsidian Tasks-format line into a Task object */
  parse(line: string): Task | null {
    const match = line.match(/^[-*+]\s+\[(.)\]\s+(.+)$/);
    if (!match) return null;

    const statusChar = match[1] as TaskStatus;
    let remaining = match[2].trim();
    const task: Task = {
      description: "",
      status: Object.values(TaskStatus).includes(statusChar)
        ? statusChar
        : TaskStatus.Todo,
      priority: TaskPriority.Normal,
    };

    // Extract priority emoji
    for (const [emoji, priority] of PRIORITY_EMOJIS) {
      if (remaining.includes(emoji)) {
        task.priority = priority;
        remaining = remaining.replace(emoji, "").trim();
        break;
      }
    }

    // Extract date/recurrence fields
    for (const [emoji, field] of Object.entries(EMOJI_PATTERNS)) {
      const regex = new RegExp(`${emoji}\\s+(\\S+(?:\\s+\\S+)*)`, "u");
      const m = remaining.match(regex);
      if (m) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (task as any)[field] = m[1].trim();
        remaining = remaining.replace(m[0], "").trim();
      }
    }

    // Extract tags
    const tagMatches = remaining.match(/#\S+/g);
    if (tagMatches) {
      task.tags = tagMatches;
      for (const tag of tagMatches) {
        remaining = remaining.replace(tag, "").trim();
      }
    }

    task.description = remaining.replace(/\s+/g, " ").trim();
    return task;
  }

  /** Format a Task object as an Obsidian Tasks-format line */
  format(task: Task): string {
    const parts: string[] = [`- [${task.status}] ${task.description}`];

    if (task.priority !== TaskPriority.Normal) {
      parts.push(task.priority);
    }
    if (task.startDate) parts.push(`🛫 ${task.startDate}`);
    if (task.scheduledDate) parts.push(`⏳ ${task.scheduledDate}`);
    if (task.dueDate) parts.push(`📅 ${task.dueDate}`);
    if (task.createdDate) parts.push(`➕ ${task.createdDate}`);
    if (task.doneDate) parts.push(`✅ ${task.doneDate}`);
    if (task.recurrence) parts.push(`🔁 ${task.recurrence}`);

    return parts.join(" ");
  }

  /** Create a new task line with today's created date */
  create(
    description: string,
    options: Partial<Omit<Task, "description" | "status">> = {},
  ): string {
    const today = new Date().toISOString().slice(0, 10);
    const task: Task = {
      description,
      status: TaskStatus.Todo,
      priority: options.priority ?? TaskPriority.Normal,
      createdDate: options.createdDate ?? today,
      dueDate: options.dueDate,
      startDate: options.startDate,
      scheduledDate: options.scheduledDate,
      recurrence: options.recurrence,
      tags: options.tags,
    };
    return this.format(task);
  }

  /** Find all tasks in a markdown string */
  findAll(markdown: string): { line: number; task: Task }[] {
    const results: { line: number; task: Task }[] = [];
    const lines = markdown.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const task = this.parse(lines[i]);
      if (task) results.push({ line: i + 1, task });
    }
    return results;
  }

  /** Mark a task as done in a markdown string (by line number, 1-indexed) */
  completeTask(markdown: string, lineNumber: number): string {
    const lines = markdown.split("\n");
    const idx = lineNumber - 1;
    if (idx < 0 || idx >= lines.length) return markdown;

    const task = this.parse(lines[idx]);
    if (!task) return markdown;

    task.status = TaskStatus.Done;
    task.doneDate = new Date().toISOString().slice(0, 10);
    lines[idx] = this.format(task);
    return lines.join("\n");
  }
}
