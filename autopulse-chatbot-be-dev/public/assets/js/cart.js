function showcart(url){
   mydata ='';
    var csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    if (typeof mydata === 'string') {
        mydata += '&_token=' + csrfToken;
    } else if (typeof mydata === 'object' && !(mydata instanceof FormData)) {
        mydata._token = csrfToken;
    } else if (mydata instanceof FormData) {
        mydata.append('_token', csrfToken);
    }
    runajax(url,mydata , 'post', '', 'json', function(response) {
  
        $('#storeCheckout').modal('show');
        $('#cardpopupbody').html(response.html);
       
    }); 
}

function newloadStoreCartPopup(url, data = {}) {
   
    // Add CSRF token to the data
    var csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    if (typeof data === 'object' && !(data instanceof FormData)) {
        data._token = csrfToken;
    }

    runajax(url, data, 'post', '', 'json', function(response) {
        $('#storeCheckout').modal('show');
        $('#cardpopupbody').html(response.html);
    });
}

function storesubscriptionenable(url, storelist) {
    store= JSON.parse(storelist);
   
    const data = { storelist: store };
    newloadStoreCartPopup(url, data);
}