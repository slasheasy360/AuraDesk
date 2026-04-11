import laptopUrl from '../assets/laptop.png';

/**
 * Laptop image with the dashboard mockup overlaid inside the screen aperture.
 * Positioning is the responsibility of the parent — wrap this in any
 * absolutely-positioned or sized container.
 */
export default function LaptopWithDashboard() {
  return (
    <div className="relative">
      <img
        src={laptopUrl}
        alt="Laptop"
        className="block w-full h-auto"
        style={{
          filter: 'drop-shadow(0 30px 40px rgba(0,0,0,0.55))',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, #000 8%, #000 100%)',
          maskImage:
            'linear-gradient(to bottom, transparent 0%, #000 8%, #000 100%)',
        }}
      />
      {/* Dashboard UI overlay — calibrated to laptop SVG screen aperture */}
    
    </div>
  );
}
