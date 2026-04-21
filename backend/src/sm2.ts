import type { Grade } from './types.js';

export type CardRow = {
  status: 'new' | 'learning' | 'review';
  step: number;
  dueDate: number;
  interval: number;
  repetition: number;
  efactor: number;
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];

export function calculateNextReview(card: CardRow, grade: Grade): CardRow {
  let { status, step, interval, repetition, efactor } = card;
  let dueDate = Date.now();

  if (status === 'new') {
    status = 'learning';
    step = 0;
    interval = 0;
    repetition = 0;
  }

  if (status === 'learning') {
    if (grade === 'again') {
      step = 0;
      dueDate += LEARNING_STEPS[step];
    } else if (grade === 'hard') {
      dueDate += LEARNING_STEPS[step];
    } else if (grade === 'good') {
      step += 1;
      if (step >= LEARNING_STEPS.length) {
        status = 'review';
        interval = 1;
        repetition = 1;
        dueDate += interval * DAY;
      } else {
        dueDate += LEARNING_STEPS[step];
      }
    } else if (grade === 'easy') {
      status = 'review';
      interval = 4;
      repetition = 1;
      dueDate += interval * DAY;
    }
    return { status, step, interval, repetition, efactor, dueDate };
  }

  let quality = 0;
  switch (grade) {
    case 'again':
      quality = 0;
      break;
    case 'hard':
      quality = 3;
      break;
    case 'good':
      quality = 4;
      break;
    case 'easy':
      quality = 5;
      break;
  }

  if (quality < 3) {
    status = 'learning';
    step = 0;
    repetition = 0;
    interval = 0;
    dueDate += LEARNING_STEPS[0];
  } else {
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * efactor);
    }
    repetition += 1;
    dueDate += interval * DAY;
  }

  efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (efactor < 1.3) efactor = 1.3;

  return { status, step, interval, repetition, efactor, dueDate };
}
