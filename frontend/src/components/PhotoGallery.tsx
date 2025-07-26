import React, { useState } from 'react'
import { Users, Image, AlertCircle, CheckCircle2, Eye } from 'lucide-react'

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

interface PhotoGalleryProps {
  groupedPhotos: GroupedPhotos[]
}

const PhotoGallery: React.FC<PhotoGalleryProps> = ({ groupedPhotos }) => {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50'
    if (confidence >= 0.6) return 'text-yellow-600 bg-yellow-50'
    return 'text-red-600 bg-red-50'
  }

  const getConfidenceIcon = (confidence: number) => {
    if (confidence >= 0.8) return <CheckCircle2 className="h-4 w-4" />
    return <AlertCircle className="h-4 w-4" />
  }

  const totalPhotos = groupedPhotos.reduce((sum, group) => sum + group.count, 0)
  const detectedPhotos = groupedPhotos
    .filter(group => group.bib_number !== 'unknown')
    .reduce((sum, group) => sum + group.count, 0)
  const unknownPhotos = groupedPhotos.find(group => group.bib_number === 'unknown')?.count || 0

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Processing Results</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center">
              <Image className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="text-sm text-blue-600">Total Photos</p>
                <p className="text-2xl font-bold text-blue-900">{totalPhotos}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm text-green-600">Detected</p>
                <p className="text-2xl font-bold text-green-900">{detectedPhotos}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="flex items-center">
              <AlertCircle className="h-8 w-8 text-yellow-600 mr-3" />
              <div>
                <p className="text-sm text-yellow-600">Unknown</p>
                <p className="text-2xl font-bold text-yellow-900">{unknownPhotos}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groupedPhotos.map((group) => (
          <div
            key={group.bib_number}
            className="bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Users className="h-5 w-5 text-gray-400 mr-2" />
                  <h3 className="text-lg font-semibold">
                    {group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}
                  </h3>
                </div>
                <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
                  {group.count} photos
                </span>
              </div>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 gap-2">
                {group.photos.slice(0, 4).map((photo, index) => (
                  <div
                    key={photo.id}
                    className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer group"
                    onClick={() => setSelectedPhoto(photo.id)}
                  >
                    <div className="absolute inset-0 bg-gray-200 flex items-center justify-center">
                      <Image className="h-8 w-8 text-gray-400" />
                    </div>
                    
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center">
                      <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    {photo.detection_result && (
                      <div className={`absolute top-1 right-1 px-2 py-1 rounded text-xs flex items-center ${getConfidenceColor(photo.detection_result.confidence)}`}>
                        {getConfidenceIcon(photo.detection_result.confidence)}
                        <span className="ml-1">{Math.round(photo.detection_result.confidence * 100)}%</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {group.count > 4 && (
                <button
                  onClick={() => setSelectedGroup(selectedGroup === group.bib_number ? null : group.bib_number)}
                  className="w-full mt-3 text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  {selectedGroup === group.bib_number ? 'Show Less' : `View All ${group.count} Photos`}
                </button>
              )}

              {selectedGroup === group.bib_number && group.count > 4 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {group.photos.slice(4).map((photo) => (
                    <div
                      key={photo.id}
                      className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer group"
                      onClick={() => setSelectedPhoto(photo.id)}
                    >
                      <div className="absolute inset-0 bg-gray-200 flex items-center justify-center">
                        <Image className="h-6 w-6 text-gray-400" />
                      </div>
                      
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center">
                        <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      {photo.detection_result && (
                        <div className={`absolute top-1 right-1 px-1 py-0.5 rounded text-xs flex items-center ${getConfidenceColor(photo.detection_result.confidence)}`}>
                          {Math.round(photo.detection_result.confidence * 100)}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PhotoGallery