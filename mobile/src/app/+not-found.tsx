import { Stack } from 'expo-router';

import PlaceholderScreen from '@/components/PlaceholderScreen';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <PlaceholderScreen
        title="Page not found"
        description="This screen does not exist."
        links={[{ label: 'Go to Home', href: '/' }]}
      />
    </>
  );
}
