const platformConfig = {
  facebook: { label: 'Facebook', color: 'bg-blue-500', textColor: 'text-blue-600', bgLight: 'bg-blue-100' },
  instagram: { label: 'Instagram', color: 'bg-pink-500', textColor: 'text-pink-600', bgLight: 'bg-pink-100' },
  whatsapp: { label: 'WhatsApp', color: 'bg-green-500', textColor: 'text-green-600', bgLight: 'bg-green-100' },
  gmail: { label: 'Gmail', color: 'bg-red-500', textColor: 'text-red-600', bgLight: 'bg-red-100' },
};

export default function PlatformBadge({ platform, size = 'md', className = '' }) {
  const config = platformConfig[platform] || { label: platform, color: 'bg-gray-500', textColor: 'text-gray-600', bgLight: 'bg-gray-100' };

  if (size === 'sm') {
    return (
      <div className={`w-4 h-4 ${config.color} rounded-full border-2 border-white ${className}`} title={config.label} />
    );
  }

  if (size === 'xs') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.bgLight} ${config.textColor}`}>
        {config.label}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${config.bgLight} ${config.textColor} ${className}`}>
      {config.label}
    </span>
  );
}
