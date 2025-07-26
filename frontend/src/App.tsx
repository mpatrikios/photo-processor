import { useState } from 'react'
import PhotoUpload from './components/PhotoUpload'
import PhotoGallery from './components/PhotoGallery'
import ProcessingStatus from './components/ProcessingStatus'
import ExportControls from './components/ExportControls'
import './App.css'

type AppState = 'upload' | 'processing' | 'results'

function App() {
  const [appState, setAppState] = useState<AppState>('upload')
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [jobId, setJobId] = useState<string>('')
  const [groupedPhotos, setGroupedPhotos] = useState<any[]>([])

  const handleUploadComplete = (ids: string[]) => {
    setPhotoIds(ids)
    setAppState('processing')
  }

  const handleProcessingComplete = (results: any[]) => {
    setGroupedPhotos(results)
    setAppState('results')
  }

  const handleReset = () => {
    setAppState('upload')
    setPhotoIds([])
    setJobId('')
    setGroupedPhotos([])
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Race Photo Processor
          </h1>
          <p className="text-lg text-gray-600">
            Upload race photos and automatically sort them by bib numbers
          </p>
        </header>

        {appState === 'upload' && (
          <PhotoUpload onUploadComplete={handleUploadComplete} />
        )}

        {appState === 'processing' && (
          <ProcessingStatus 
            photoIds={photoIds} 
            onJobId={setJobId}
            onComplete={handleProcessingComplete}
          />
        )}

        {appState === 'results' && (
          <div>
            <PhotoGallery groupedPhotos={groupedPhotos} />
            <ExportControls 
              groupedPhotos={groupedPhotos}
              onReset={handleReset}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
