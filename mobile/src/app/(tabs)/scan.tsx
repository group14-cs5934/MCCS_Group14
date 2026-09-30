import PlaceholderScreen from '@/components/PlaceholderScreen';

export default function ScanScreen() {
  return (
    <PlaceholderScreen
      title="Scan"
      description="Camera permission and barcode scanner are built in T028–T030."
      links={[{ label: 'Simulate a scan result', href: '/product/sample-lays' }]}
    />
  );
}
