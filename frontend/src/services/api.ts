import axios from 'axios'

const API_BASE_URL = 'http://localhost:8000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
})

export interface UploadResponse {
  photo_ids: string[]
  message: string
}

export interface ProcessingJob {
  job_id: string
  photo_ids: string[]
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  completed_photos: number
  total_photos: number
}

export interface GroupedPhotos {
  bib_number: string
  photos: PhotoInfo[]
  count: number
}

export interface PhotoInfo {
  id: string
  filename: string
  original_path: string
  processed_path?: string
  detection_result?: DetectionResult
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

export interface DetectionResult {
  bib_number?: string
  confidence: number
  bbox?: number[]
}

export const uploadPhotos = async (files: File[]): Promise<UploadResponse> => {
  const formData = new FormData()
  
  files.forEach(file => {
    formData.append('files', file)
  })

  const response = await api.post('/upload/photos', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  return response.data
}

export const startProcessing = async (photoIds: string[]): Promise<ProcessingJob> => {
  const response = await api.post('/process/start', photoIds)
  return response.data
}

export const getProcessingStatus = async (jobId: string): Promise<ProcessingJob> => {
  const response = await api.get(`/process/status/${jobId}`)
  return response.data
}

export const getProcessingResults = async (jobId: string): Promise<GroupedPhotos[]> => {
  const response = await api.get(`/process/results/${jobId}`)
  return response.data
}

export const createExport = async (photoIds: string[]): Promise<{ export_id: string; download_url: string }> => {
  const response = await api.post('/download/export', { photo_ids: photoIds })
  return response.data
}

export const downloadExport = (exportId: string): string => {
  return `${API_BASE_URL}/download/file/${exportId}`
}