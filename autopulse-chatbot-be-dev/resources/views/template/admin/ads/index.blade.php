@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Ads</h2>
            <div class="page_title_btn ms-auto">
                <button class="btn btn_theme" id="createAd">Add Ad</button>
            </div>
        </div>
    </div>
    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif
    <hr>

    <div class="row">
        
        <div class="col col-12">
            <div class="position-relative table-responsive">
                <table class="table table-bordered w-100 dataTable" id="ads_tabl">
                    <thead>
                        <tr>
                            <td>#</td>
                            <td>Name</td>
                            <td>Slot</td>
                            <td>Page</td>
                            <td>Date</td>
                            <td>Action</td>
                        </tr>
                    </thead>
                   
                </table>

            </div>
        </div>
    </div>
</div>


<!-- Ad -->
<div class="modal fade" id="adModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="adHeading" class="modal-title"></h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form action="{{ route('ads.store') }}" id="adsForm" method="post">
                        <input type="hidden" name="ads_id" id="ads_id" >
                        <input type="hidden" name="ads_enabled" id="ads_enabled" >
                        @csrf
                        <div class="row">
                           
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Select Page</label>
                                    <select id="ad-page" name="page" class="form-control required">
                                        <option value="">--Select Page--</option>
                                        <option value="home-page">Home Page</option>
                                        <option value="car-list-page">Car List Page</option>
                                    </select>
                                </div>                                    
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Select Slot</label>
                                    <select id="ad-slot" name="slot" class="form-control required">
                                        <option value="">--Select Slot--</option>
                                    </select>
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Name</label>
                                    <input type="text" id="ad-name" class="form-control required"  name="name">
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Ad Code</label>
                                    <textarea type="text" id="ad-code" class="form-control required"  name="adcode" cols="8" rows="8"></textarea>
                                </div>
                            </div>
                           
                        </div>
                        
                        <div class="row">
                            <div class="col col-12 text-center">
                                <button type="submit" id="adsubmit" class="btn btn_theme" value="create">Submit</button>
                            </div>
                        </div>  

                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Enabled -->
<div  class="modal fade" id="enabledModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-check fa-4x mb-3 text-success"></i>
                <h5 class="mb-4">Are you sure? You want to enable?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn_theme" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn_dark ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>

<!-- Disabled -->
<div  class="modal fade" id="disabledModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                <h5 class="mb-4">Are you sure? You want to disable?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn_theme" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn_dark ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>

<!-- Delete -->
<div  class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                <h5 class="mb-4">Are you sure? You want to delete?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn_theme" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn_dark ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>
@endsection
@section('script')
<script>
var ads ='';
var myurl = '{{route('ads.tableData')}}';
$(function () {
    //$(document).on('change','#editModal select.page',function(){
    $("#adModal select#ad-page").on('change',function () {
        var page = $(this).val();
        
        if(page == 'home-page')
        {
            $('#ad-slot').empty();
            $('#ad-slot').append('<option value="">--Select Slot--</option>'+
                            '<option value="1">Banner 1 Ad (728px x 90px)</option>'+
                            '<option value="2">Banner 2 Ad (728px x 90px)</option>'+
                            '<option value="3">Banner 3 Ad (728px x 90px)</option>');  
        }
        if(page == 'car-list-page')
        {
            $('#ad-slot').empty();
            $('#ad-slot').append('<option value="">--Select Slot--</option>'+
                            '<option value="1">Card 1 Ad (300px x 250px)</option>'+
                            '<option value="2">Card 2 Ad (300px x 250px)</option>');  
        }
        if(page == '')
        {
            $('#ad-slot').empty();
            $('#ad-slot').append('<option value="">--Select Slot--</option>');  
        }
    });

    $('#createAd').click(function () {
        $('#adsubmit').val("create-ad");
        $('#ads_id').val('');
        $('#ad-page option').removeAttr('selected');
        $('#ads_enabled').val('');
        $('#adsForm').trigger("reset");
        $('#adHeading').html("Create Ad");
        $('#adModal').modal('show');
        $('#ad-slot').empty();
        $('#ad-slot').append('<option value="">--Select Slot--</option>');  
    });

    $('body').on('click', '.editAd', function () {
        var ads_id = $(this).data('id');
        $.get("{{ route('ads.index') }}" +'/' + ads_id +'/edit', function (data) {
            $('#adHeading').html("Edit Ad");
            $('#adsubmit').val("edit-ad");
            $('#adModal').modal('show');
            $('#ad-slot').empty();
            $('#ad-slot').append('<option value="">--Select Slot--</option>');  
            $('#ads_id').val(data.id);
            $('#ads_enabled').val(data.enabled);
            $('#ad-page option').removeAttr('selected');
            if(data.page == 'home-page')
            {
                $('#ad-slot').append('<option value="">--Select Slot--</option>'+
                                '<option value="1">Banner 1 Ad (728px x 90px)</option>'+
                                '<option value="2">Banner 2 Ad (728px x 90px)</option>'+
                                '<option value="3">Banner 3 Ad (728px x 90px)</option>');  
            }
            if(data.page == 'car-list-page')
            {
                $('#ad-slot').append('<option value="">--Select Slot--</option>'+
                                '<option value="1">Card 1 Ad (300px x 250px)</option>'+
                                '<option value="2">Card 2 Ad (300px x 250px)</option>');  
            }
            $('#ad-page option[value="'+data.page+'"]').attr("selected", "selected");
            $('#ad-slot option[value="'+data.slot+'"]').attr("selected", "selected");
            $('#ad-name').val(data.name);
            $('#ad-code').val(data.code);
        });
    });

});

ads= $('#ads_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('ads.tableData')}}?source=ads',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'name', name: 'name' },
        { data: 'slot', name: 'slot' },
        { data: 'page', name: 'page' },
        {
            data: 'created_at',
            name: 'created_at',
            render: function (data, type, row) {
                if (type === 'display' || type === 'filter') {
                    return moment(data).format('DD-MM-YYYY HH:mm:ss'); // Adjust the format as needed
                }
                return data;
            },
        },
        
        {
            data: null,
            orderable: false, // Disable sorting on this column
            searchable: false, // Disable searching on this column
            render: function (data, type, row) {
               
                enableddurl = `{{ route('ads.enable') }}`+'?ads_id='+row.id
                disabledurl = `{{ route('ads.disable') }}`+'?ads_id='+row.id;
                deleteurl = `{{ route('ads.delete') }}`+'?ads_id='+row.id;

                 var publishButton = row.enabled
                    ? `<button class="btn btn-outline-success btn-sm" data-bs-toggle="modal" data-bs-target="#disabledModal"
                        onclick="seturl('`+disabledurl+`')">
                        Enabled
                    </button>`
                    : `<button class="btn btn-outline-danger btn-sm" data-bs-toggle="modal" data-bs-target="#enabledModal"
                        onclick="seturl('`+enableddurl+`')">
                        Disabled
                    </button>`;

                var editButton = `<button class="btn btn_theme btn-sm editAd" data-id="`+row.id+`">Edit</button>`;

                var deleteButton = `<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#deleteModal"
                onclick="seturl('`+deleteurl+`')">
                Delete
                </button>`;
                return publishButton +' '+ editButton +' '+ deleteButton;

            },
        },

        // Add other columns as needed
    ],
    language: {
        paginate: {
            first: 'First',
            last: 'Last',
            next: '&rarr;',
            previous: '&larr;',
        },
        lengthMenu: 'Show <select>' +
            '<option value="1" selected>1</option>' +
            '<option value="2">2</option>' +
            '<option value="3">4</option>' +
            '<option value="4">6</option>' +
            '<option value="-1">All</option>' +
            '</select> records',
                /* "oLanguage": {
            "sLengthMenu": "Display _MENU_ records per page",
            // other language options
        },*/

        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
        
    },
});

$('#adsForm').on('submit', function (event) {
            
    event.preventDefault();
        if($(this).valid()){
        var submitButton = $(this).find('[type="submit"]');
            submitButton.prop('disabled', true).text('Please wait...');

        // Serialize form data
            var formData = $(this).serialize();
        
            url =$(this).attr('action');
            runajax(url, formData, 'post', '', 'json', function(output) {
                    // var output = JSON.parse(res);
                    submitButton.prop('disabled', false).text('Submit');
                    ads.ajax.reload();
                    $('.modal').modal('hide');
                    $('#adsForm')[0].reset();
            
            })
        }
});

function actionmethod()
{
    actionsurl = $('#seturl').val();

    runajax(actionsurl, '', 'get', '', 'json', function(output) {
            
            console.log(output);
            if (output.success) 
            {
                $('.modal').modal('hide');
                ads.ajax.reload();

            }else{
                       
            }
        }); 
}

function seturl(url)
{
    $('#seturl').val(url);

}

</script>
@endsection

