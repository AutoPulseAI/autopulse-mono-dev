
function uploadajax(url, mydata, type, responseid, returntype, fn)
{
    //$('.loader').show();
    //notify('Please wait...',2);
    $('.loading').show();
    $.ajax({
        type: type,
        url: url,
        cache: false,
      
        contentType: false,
        processData: false,
        data: mydata,
        success: function(res) {
            $('.loading').hide();
            if (typeof fn === 'function') {
                fn(res);
                $('.loading').hide();
            }
            else{
                $('.loading').hide();
                if (returntype == 'json') {
                    var json = JSON.parse(res);
                    if (typeof json.msg != 'undefined')
                    {
                        alert(json.msg);
                    }
                }
            }
           
        },
        error: function(xhr, error, thrown){
            //get the status code
            $('.loading').hide();
            if(xhr==401){
                alert('Not Authorized to access this page');
                //$.notify('You are not authorized to access this functionality', "error");
            }
           
        },
    });

}

function runajax(url, mydata, type, responseid, returntype, fn) {
    //notify('Please wait...',2);
    $('.loading').show();
    $.ajax({
        type: type,
        url: url,
        data: mydata,
        
        success: function (res) {
            $('.loading').hide();
            if (typeof fn === 'function') {
                fn(res);
                $('.calc-loader').hide();
                //hideNotify();
            }
            else {
                //$('.calc-loader').hide();
                if (returntype == 'json') {
                    var json = JSON.parse(res);
                    if (typeof json.msg != 'undefined') {
                        alert(json.msg);
                    }
                }
            }
        },
        error: function(xhr, error, thrown){
            //get the status code
            $('.loading').hide();
            if(xhr==401){
                $.notify('You are not authorized to access this functionality', "error");
            }
           
        },
    });
}