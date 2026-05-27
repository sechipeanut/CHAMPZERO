// Shared Utility Functions

/**
 * Calculate status based on start and end dates
 * @param {Date|Timestamp|string} startDate - Start date (can be Firestore Timestamp, Date, or string)
 * @param {Date|Timestamp|string} endDate - End date (can be Firestore Timestamp, Date, or string)
 * @returns {string} - Status: 'Upcoming', 'Ongoing', or 'Completed'
 */
export function calculateStatus(startDate, endDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to midnight for accurate comparison
    
    if (!startDate) return 'Upcoming'; // Default if no date
    
    // Handle Firestore Timestamp objects
    const start = startDate.toDate ? startDate.toDate() : new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    // If end date exists, use it; otherwise use start date
    const end = endDate 
        ? (endDate.toDate ? endDate.toDate() : new Date(endDate))
        : new Date(start);
    end.setHours(23, 59, 59, 999); // End of the day
    
    if (today < start) {
        return 'Upcoming';
    } else if (today >= start && today <= end) {
        return 'Ongoing';
    } else {
        return 'Completed';
    }
}

/**
 * Convert a date value to YYYY-MM-DD format for HTML5 date inputs
 * @param {Date|Timestamp|string} dateValue - Date value to convert
 * @returns {string} - Date in YYYY-MM-DD format
 */
export function toDateInputFormat(dateValue) {
    if (!dateValue) return '';
    
    // Handle Firestore Timestamp objects
    const dateObj = dateValue.toDate ? dateValue.toDate() : new Date(dateValue);
    
    // Convert to YYYY-MM-DD format
    return dateObj.toISOString().split('T')[0];
}

/**
 * Escape a URL for safe use in CSS background-image
 * @param {string} url - URL to escape
 * @returns {string} - Escaped URL
 */
export function escapeCssUrl(url) {
    if (!url) return '';
    // Escape backslashes, single quotes, and parentheses
    return url.replace(/[\\\'()]/g, '\\$&');
}

/**
 * Uploads an image file to Firebase Storage
 * @param {File} file - The file to upload
 * @param {string} folderPath - The folder path in the storage bucket (e.g. "avatars", "banners")
 * @returns {Promise<string>} - The download URL of the uploaded image
 */
import { storage } from './firebase-config.js';
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";

export async function uploadImage(file, folderPath) {
    if (!file) throw new Error("No file selected for upload.");
    
    // Create a unique filename
    const uniqueFileName = `${Date.now()}_${file.name}`;
    const storageRef = ref(storage, `${folderPath}/${uniqueFileName}`);
    
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        return downloadURL;
    } catch (error) {
        console.error("Error uploading image:", error);
        throw error;
    }
}
