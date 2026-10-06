import Ionicons from '@expo/vector-icons/Ionicons';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';

// T014 acceptance: when a component is given loading or error props, it shows the spinner or
// error banner instead of content.

// The first icon rendered loads the icon font and re-renders once it's ready, outside act().
// Load it up front so tests don't log act() warnings.
beforeAll(() => Ionicons.loadFont());

const content = <Text>Product details</Text>;

describe.each([
  { name: 'Card', Component: Card },
  { name: 'AsyncContent', Component: AsyncContent },
])('$name loading and error props', ({ Component }) => {
  it('shows the content when not loading and there is no error', () => {
    render(<Component>{content}</Component>);

    expect(screen.getByText('Product details')).toBeOnTheScreen();
    expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  it('shows a spinner instead of the content while loading', () => {
    render(<Component loading>{content}</Component>);

    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    expect(screen.queryByText('Product details')).not.toBeOnTheScreen();
  });

  it('shows the error instead of the content when given an error', () => {
    render(<Component error="Couldn't load this product.">{content}</Component>);

    expect(screen.getByRole('alert', { name: /Couldn't load this product\./ })).toBeOnTheScreen();
    expect(screen.queryByText('Product details')).not.toBeOnTheScreen();
  });

  it('calls onRetry when Try Again is pressed', () => {
    const onRetry = jest.fn();
    render(
      <Component error="Network error" onRetry={onRetry}>
        {content}
      </Component>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Try Again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the spinner, not the error, while a retry is loading', () => {
    render(
      <Component loading error="Network error">
        {content}
      </Component>,
    );

    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });
});

describe('Button', () => {
  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    render(<Button title="Scan Product" icon="scan-outline" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Scan Product' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner instead of the title and ignores presses while loading', () => {
    const onPress = jest.fn();
    render(<Button title="Save" loading onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeBusy();
    expect(screen.queryByText('Save')).not.toBeOnTheScreen();

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores presses when disabled', () => {
    const onPress = jest.fn();
    render(<Button title="Save" disabled onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Card', () => {
  it('calls onPress when a tappable card is pressed', () => {
    const onPress = jest.fn();
    render(<Card onPress={onPress}>{content}</Card>);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not tappable while loading or showing an error', () => {
    const onPress = jest.fn();
    const { rerender } = render(
      <Card onPress={onPress} loading>
        {content}
      </Card>,
    );
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();

    rerender(
      <Card onPress={onPress} error="Network error">
        {content}
      </Card>,
    );
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });
});

describe('ErrorBanner', () => {
  it('reads the title and message as one alert', () => {
    render(<ErrorBanner title="Prices unavailable" message="Check your connection." />);

    expect(
      screen.getByRole('alert', { name: 'Prices unavailable. Check your connection.' }),
    ).toBeOnTheScreen();
  });

  it('has no retry button without onRetry', () => {
    render(<ErrorBanner message="Network error" />);

    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });
});

describe('ErrorState', () => {
  it('shows a default title', () => {
    render(<ErrorState message="Network error" />);

    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
  });

  it('shows extra actions next to retry (e.g. unknown product: Retry + Search)', () => {
    const onRetry = jest.fn();
    const onSearch = jest.fn();
    render(
      <ErrorState
        title="Product not found"
        message="We couldn't find that barcode."
        onRetry={onRetry}
        retryLabel="Retry"
      >
        <Button title="Search" variant="secondary" onPress={onSearch} />
      </ErrorState>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.press(screen.getByRole('button', { name: 'Search' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});

describe('Loader', () => {
  it('shows its message and uses it as the accessible name', () => {
    render(<Loader message="Loading product…" />);

    expect(screen.getByRole('progressbar', { name: 'Loading product…' })).toBeOnTheScreen();
    expect(screen.getByText('Loading product…')).toBeOnTheScreen();
  });
});
