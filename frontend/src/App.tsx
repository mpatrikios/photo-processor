import { useState } from 'react'
import PhotoUpload from './components/PhotoUpload'
import PhotoGallery from './components/PhotoGallery'
import ProcessingStatus from './components/ProcessingStatus'
import ExportControls from './components/ExportControls'
import styles from './App.module.css'

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
    <div className={styles.container}>
      <div className={styles.maxWidth}>
        <header className={styles.header}>
          <h1 className={styles.title}>
            Race Photo Processor
          </h1>
          <p className={styles.subtitle}>
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
