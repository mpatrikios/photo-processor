import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { startProcessing, getProcessingStatus, getProcessingResults } from '../services/api'

interface ProcessingJob {
  job_id: string
  photo_ids: string[]
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  completed_photos: number
  total_photos: number
}

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

interface ProcessingStatusProps {
  photoIds: string[]
  onJobId: (jobId: string) => void
  onComplete: (results: GroupedPhotos[]) => void
}

const ProcessingStatus: React.FC<ProcessingStatusProps> = ({
  photoIds,
  onJobId,
  onComplete
}) => {
  const [job, setJob] = useState<ProcessingJob | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    initializeProcessing()
  }, [photoIds])

  useEffect(() => {
    if (job?.job_id) {
      onJobId(job.job_id)
      
      if (job.status === 'completed') {
        fetchResults()
      } else if (job.status === 'processing' || job.status === 'pending') {
        const interval = setInterval(checkStatus, 2000)
        return () => clearInterval(interval)
      }
    }
  }, [job])

  const initializeProcessing = async () => {
    try {
      const newJob = await startProcessing(photoIds)
      setJob(newJob)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to start processing')
    }
  }

  const checkStatus = async () => {
    if (!job?.job_id) return

    try {
      const updatedJob = await getProcessingStatus(job.job_id)
      setJob(updatedJob)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to check status')
    }
  }

  const fetchResults = async () => {
    if (!job?.job_id) return

    try {
      const results = await getProcessingResults(job.job_id)
      onComplete(results)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch results')
    }
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-800 mb-2">
            Processing Error
          </h3>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Initializing processing...</p>
      </div>
    )
  }

  const getStatusColor = () => {
    switch (job.status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'processing':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'completed':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getStatusText = () => {
    switch (job.status) {
      case 'pending':
        return 'Waiting to start...'
      case 'processing':
        return 'Processing photos...'
      case 'completed':
        return 'Processing complete!'
      case 'failed':
        return 'Processing failed'
      default:
        return 'Unknown status'
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className={`border rounded-lg p-6 ${getStatusColor()}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Processing Photos</h3>
          {(job.status === 'pending' || job.status === 'processing') && (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
        </div>

        <p className="mb-4">{getStatusText()}</p>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span>Progress:</span>
            <span>{job.completed_photos} / {job.total_photos} photos</span>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>

          <div className="text-center text-sm text-gray-600">
            {job.progress}% complete
          </div>
        </div>

        {job.status === 'completed' && (
          <div className="mt-4 text-center">
            <p className="text-green-600 font-medium">
              All photos processed successfully!
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Preparing results...
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProcessingStatus