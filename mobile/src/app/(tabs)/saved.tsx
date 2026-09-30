import PlaceholderScreen from '@/components/PlaceholderScreen';

export default function SavedScreen() {
  return (
    <PlaceholderScreen
      title="Saved"
      description="Saved products list is a stretch goal."
      links={[{ label: 'Open a saved product', href: '/product/sample-oatly' }]}
    />
  );
}
