# pypdepsim

Discover similar Python packages using Jaccard similarity analysis on shared dependencies.

## Overview

**pypdepsim** is a web application that helps Python developers find similar packages by analyzing shared dependencies and reverse dependencies from the PyPI ecosystem. It uses Jaccard similarity to identify packages that are commonly used together or serve similar purposes.

### Features

- 🔍 **Search for any Python package** - Find similar and co-occurring packages
- 📊 **Jaccard similarity analysis** - Scientifically accurate similarity scores
- 📈 **Package metadata** - View descriptions, versions, dependencies, and download stats
- 🌙 **Dark mode** - Comfortable viewing in any lighting condition
- 📱 **Responsive design** - Works on desktop, tablet, and mobile devices
- ⚡ **Real-time data** - Fetches fresh data from PyPI and Libraries.io

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Internet connection (for fetching package data)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd pypdepsim
```

2. Install dependencies:
```bash
npm install
```

3. (Optional) Download Libraries.io CSV data for reverse dependencies:
```bash
npm run download-csv
```

This step is optional but recommended for better reverse dependency coverage. The application will work without it, but may have limited data for some packages.

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Basic Search

1. Enter a Python package name in the search box (e.g., `requests`, `pandas`, `numpy`)
2. Click "Find Similar" or press Enter
3. View the results:
   - **Package Metadata**: Description, version, dependencies, and download statistics
   - **Similar Packages**: Packages that share many of the same dependents
   - **Co-occurring Packages**: Packages commonly used together with your searched package

### Understanding Results

- **Similarity Score**: A percentage (0-100%) indicating how similar two packages are based on shared dependents
- **Shared Dependents**: The number of packages that use both your searched package and the similar one
- **Co-occurrence**: How often packages appear together in dependency lists

### Example Searches

Try searching for:
- `requests` - Find HTTP client alternatives
- `pandas` - Discover data analysis tools
- `flask` - Explore web framework options
- `numpy` - Find numerical computing libraries

## How It Works

### Jaccard Similarity

The tool uses **Jaccard similarity** to measure package similarity:

```
Jaccard = (Packages using both A and B) / (Packages using A or B)
```

- A score of 1.0 means perfect similarity
- A score of 0.0 means no overlap
- Scores are converted to percentages for display

### Data Sources

- **PyPI JSON API**: Package metadata, dependencies, and descriptions
- **Libraries.io CSV Dumps**: Reverse dependency data (monthly updates)
- **PyPI Stats API**: Download statistics

### Similar vs Co-occurring

- **Similar Packages**: Share many of the same reverse dependents (packages that depend on them), indicating similar purposes
- **Co-occurring Packages**: Commonly found together in the same dependency lists, indicating they're often used in combination

## Development

### Project Structure

```
pypdepsim/
├── app/
│   ├── api/              # API routes
│   ├── components/       # React components
│   ├── globals.css       # Global styles
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Main page
├── lib/                  # Utility libraries
├── scripts/              # Data management scripts
├── data/                 # Data files and cache
└── package.json
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run download-csv` - Download Libraries.io CSV data
- `npm run weekly-update` - Update package data (for data management)

### API Endpoints

- `GET /api/health` - Health check
- `GET /api/categories/popular` - List of popular packages
- `GET /api/meta/[pkg]` - Package metadata
- `GET /api/similar/[pkg]` - Similar and co-occurring packages
- `GET /api/reverse-deps/[pkg]` - Reverse dependencies

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the project on [Vercel](https://vercel.com)
3. Vercel will auto-detect Next.js and deploy

### Environment Variables (Optional)

- `LIBRARIES_IO_API_KEY` - Libraries.io API key (optional, for fresher data)
- `PYPI_REQUEST_DELAY_MS` - Delay between PyPI requests (default: 150ms)

## FAQ

### What's the difference between "similar" and "co-occurring" packages?

**Similar packages** share many of the same dependents, indicating they serve similar purposes. **Co-occurring packages** are commonly found together in the same dependency lists, meaning they're often used in combination.

### How accurate are the results?

Results are based on real usage data from PyPI. The similarity scores reflect actual patterns in how packages are used together in the Python ecosystem.

### Why are there no results for some packages?

Packages with few or no dependents may not have enough data for similarity analysis. New or rarely-used packages may have limited results.

### How often is the data updated?

Package metadata is fetched in real-time from PyPI. Reverse dependency data is updated regularly from Libraries.io data dumps.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Add your license here]

## Acknowledgments

- Data provided by [PyPI](https://pypi.org) and [Libraries.io](https://libraries.io)
- Built with [Next.js](https://nextjs.org) and [React](https://react.dev)

