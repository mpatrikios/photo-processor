import React, { useState } from 'react'
import { Download, RotateCcw, Package } from 'lucide-react'
import { createExport, downloadExport } from '../services/api'

interface GroupedPhotos {
  bib_number: string
  photos: PhotoInfo[]
  count: number
}

interface PhotoInfo {
  id: string
  filename: string
  original_path: string
  processed_path?: string
  detection_result?: DetectionResult
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

interface DetectionResult {
  bib_number?: string
  confidence: number
  bbox?: number[]
}

interface ExportControlsProps {
  groupedPhotos: GroupedPhotos[]
  onReset: () => void
}

const ExportControls: React.FC<ExportControlsProps> = ({ groupedPhotos, onReset }) => {
  const [exporting, setExporting] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)

  const handleGroupSelection = (bibNumber: string) => {
    setSelectedGroups(prev => 
      prev.includes(bibNumber)
        ? prev.filter(b => b !== bibNumber)
        : [...prev, bibNumber]
    )
  }

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedGroups([])
    } else {
      setSelectedGroups(groupedPhotos.map(group => group.bib_number))
    }
    setSelectAll(!selectAll)
  }

  const handleExport = async () => {
    if (selectedGroups.length === 0) return

    setExporting(true)
    
    try {
      const selectedPhotos = groupedPhotos
        .filter(group => selectedGroups.includes(group.bib_number))
        .flatMap(group => group.photos)
      
      const photoIds = selectedPhotos.map(photo => photo.id)
      
      const exportData = await createExport(photoIds)
      
      const downloadUrl = downloadExport(exportData.export_id)
      window.open(downloadUrl, '_blank')
      
    } catch (error) {
      console.error('Export failed:', error)
      alert('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const totalSelectedPhotos = groupedPhotos
    .filter(group => selectedGroups.includes(group.bib_number))
    .reduce((sum, group) => sum + group.count, 0)

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-900">Export Photos</h3>
        <button
          onClick={onReset}
          className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Start Over
        </button>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={handleSelectAll}
              className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">
              Select All Groups
            </span>
          </label>
          
          {selectedGroups.length > 0 && (
            <span className="text-sm text-gray-600">
              {selectedGroups.length} groups selected ({totalSelectedPhotos} photos)
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {groupedPhotos.map((group) => (
            <label
              key={group.bib_number}
              className="flex items-center p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedGroups.includes(group.bib_number)}
                onChange={() => handleGroupSelection(group.bib_number)}
                className="mr-3 h-4 w-4 text-blue-600 rounded border-gray-300"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}
                </p>
                <p className="text-xs text-gray-500">
                  {group.count} photos
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center text-sm text-gray-600">
          <Package className="h-4 w-4 mr-2" />
          <span>Export as organized ZIP file</span>
        </div>

        <button
          onClick={handleExport}
          disabled={selectedGroups.length === 0 || exporting}
          className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          <Download className="h-4 w-4 mr-2" />
          {exporting ? 'Creating Export...' : `Export ${totalSelectedPhotos} Photos`}
        </button>
      </div>

      {selectedGroups.length > 0 && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Export will include:</strong>
          </p>
          <ul className="text-sm text-blue-700 mt-1">
            {groupedPhotos
              .filter(group => selectedGroups.includes(group.bib_number))
              .map(group => (
                <li key={group.bib_number}>
                  • {group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}: {group.count} photos
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default ExportControls