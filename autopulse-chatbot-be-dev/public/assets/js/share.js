// script.js
function showSharePopup(id, url, title) {
    const popup = document.getElementById('share-popup');
    popup.style.display = 'flex';
    
    const fbLink = document.getElementById('share-facebook');
    fbLink.setAttribute('data-url', url);
    fbLink.setAttribute('data-title', title);
    
    const twitterLink = document.getElementById('share-twitter');
    twitterLink.setAttribute('data-url', url);
    twitterLink.setAttribute('data-title', title);
    
    const linkedInLink = document.getElementById('share-linkedin');
    linkedInLink.setAttribute('data-url', url);
    linkedInLink.setAttribute('data-title', title);
    
    const whatsappLink = document.getElementById('share-whatsapp');
    whatsappLink.setAttribute('data-url', url);
    whatsappLink.setAttribute('data-title', title);

    const smslink = document.getElementById('share-sms');
    smslink.setAttribute('data-url', url);
    smslink.setAttribute('data-title', title);
}

function closeSharePopup() {
    const popup = document.getElementById('share-popup');
    popup.style.display = 'none';
}

function shareToFb(event, element) {
    event.preventDefault();
    const url = element.getAttribute('data-url');
    const title = element.getAttribute('data-title');
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(title)}`;
    window.open(shareUrl, 'facebook-share-dialog', 'width=800,height=600');
    closeSharePopup();
}

function shareToTwitter(event, element) {
    event.preventDefault();
    const url = element.getAttribute('data-url');
    const title = element.getAttribute('data-title');
    const shareUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
    window.open(shareUrl, 'twitter-share-dialog', 'width=800,height=600');
    closeSharePopup();
}

function shareToLinkedIn(event, element) {
    event.preventDefault();
    const url = element.getAttribute('data-url');
    const title = element.getAttribute('data-title');
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
    window.open(shareUrl, 'linkedin-share-dialog', 'width=800,height=600');
    closeSharePopup();
}

function shareToWhatsApp(event, element) {
    event.preventDefault();
    const url = element.getAttribute('data-url');
    const title = element.getAttribute('data-title');
    const shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(title)}%20${encodeURIComponent(url)}`;
    window.open(shareUrl, 'whatsapp-share-dialog', 'width=800,height=600');
    closeSharePopup();
}


// function shareTosms(event, element) {
//     event.preventDefault();
//     const url = element.getAttribute('data-url');
//     const title = element.getAttribute('data-title');
//     const tempLink = document.createElement('a');
//     const shareUrl = `sms:?&body=${encodeURIComponent(title)}%20${encodeURIComponent(url)}`;
//     tempLink.setAttribute('href', shareUrl);
    
//     // Append the anchor to the body (necessary for some browsers)
//     document.body.appendChild(tempLink);
    
//     // Trigger a click event on the anchor element
//     tempLink.click();
    
//     // Remove the temporary anchor from the document
//     document.body.removeChild(tempLink);
    
//     // Close the share popup
//     closeSharePopup();
    
   
// }

function shareTosms(event, element) {
    event.preventDefault();
    const url = element.getAttribute('data-url');
    const title = element.getAttribute('data-title');
    const senderNumber = '1234567890'; // Replace with the default sender mobile number
    
    const tempLink = document.createElement('a');
    const shareUrl = `sms:${senderNumber}?&body=${encodeURIComponent(title)}%20${encodeURIComponent(url)}`;
    tempLink.setAttribute('href', shareUrl);
    
    // Append the anchor to the body (necessary for some browsers)
    document.body.appendChild(tempLink);
    
    // Trigger a click event on the anchor element
    tempLink.click();
    
    // Remove the temporary anchor from the document
    document.body.removeChild(tempLink);
    
    // Close the share popup
    closeSharePopup();
}