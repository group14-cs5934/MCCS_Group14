import Ionicons from '@expo/vector-icons/Ionicons';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import StarRating from '@/components/StarRating';

// T055 acceptance: when I tap the fourth star, four stars are highlighted.

// The first icon rendered loads the icon font and re-renders once it's ready, outside act().
beforeAll(() => Ionicons.loadFont());

/** The five stars' icons, in order: 'star' is highlighted, 'star-outline' isn't. */
function starIcons(): string[] {
  return screen.UNSAFE_getAllByType(Ionicons).map((icon) => icon.props.name);
}

/** A screen that keeps the rating in state, the way the rating form (T057) will. */
function RatingForm({ onChange }: { onChange?: (stars: number) => void }) {
  const [stars, setStars] = useState(0);
  return (
    <StarRating
      value={stars}
      onChange={(next) => {
        setStars(next);
        onChange?.(next);
      }}
    />
  );
}

const star = (name: string) => screen.getByRole('radio', { name });

describe('tapping stars', () => {
  it('highlights four stars when the fourth star is tapped', () => {
    render(<RatingForm />);

    fireEvent.press(star('4 stars'));

    expect(starIcons()).toEqual(['star', 'star', 'star', 'star', 'star-outline']);
    expect(star('4 stars')).toBeChecked();
  });

  it('starts with no stars highlighted', () => {
    render(<RatingForm />);

    expect(starIcons()).toEqual(Array(5).fill('star-outline'));
    expect(
      screen.getAllByRole('radio').filter((radio) => radio.props.accessibilityState.checked),
    ).toHaveLength(0);
  });

  it('reports the tapped star', () => {
    const onChange = jest.fn();
    render(<RatingForm onChange={onChange} />);

    fireEvent.press(star('1 star'));
    fireEvent.press(star('5 stars'));

    expect(onChange.mock.calls).toEqual([[1], [5]]);
  });

  it('changes the rating when a different star is tapped', () => {
    render(<RatingForm />);

    fireEvent.press(star('5 stars'));
    fireEvent.press(star('2 stars'));

    expect(starIcons()).toEqual(['star', 'star', 'star-outline', 'star-outline', 'star-outline']);
    expect(star('2 stars')).toBeChecked();
    expect(star('5 stars')).not.toBeChecked();
  });

  it('ignores taps while disabled', () => {
    const onChange = jest.fn();
    render(<StarRating value={3} onChange={onChange} disabled />);

    fireEvent.press(star('5 stars'));

    expect(onChange).not.toHaveBeenCalled();
    expect(star('5 stars')).toBeDisabled();
  });

  it('labels the group for screen readers', () => {
    render(<RatingForm />);

    // The group isn't one accessibility element (that would hide the stars), so find it by label.
    expect(screen.getByLabelText('Rating')).toHaveProp('accessibilityRole', 'radiogroup');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });
});

describe('showing a rating (read-only)', () => {
  it.each([
    [3, ['star', 'star', 'star', 'star-outline', 'star-outline']],
    [3.67, ['star', 'star', 'star', 'star-half', 'star-outline']], // nearest half star
    [3.2, ['star', 'star', 'star', 'star-outline', 'star-outline']],
    [4.8, ['star', 'star', 'star', 'star', 'star']],
    [0, ['star-outline', 'star-outline', 'star-outline', 'star-outline', 'star-outline']],
  ])('shows %p as %p', (value, icons) => {
    render(<StarRating value={value} />);

    expect(starIcons()).toEqual(icons);
  });

  it('describes the rating and has nothing to tap', () => {
    render(<StarRating value={3.666} />);

    expect(screen.getByRole('image', { name: 'Rated 3.7 out of 5' })).toBeOnTheScreen();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
