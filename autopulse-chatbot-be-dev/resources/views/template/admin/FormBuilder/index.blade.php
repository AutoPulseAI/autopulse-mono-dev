@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Form</h2>
            <div class="page_title_btn ms-auto">
                <a href="{{ URL('admin/formbuilder') }}" class="btn btn-primary" id="createPage">Add Form</a>
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
                <table class="table table-bordered w-100 dataTable" id="form_tabl">
                    <thead>
                        <tr>
                            <td>#</td>
                            <td>Name</td>
                            <td>Date</td>
                            <td>Action</td>
                        </tr>
                    </thead>
                   
                </table>

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
                    <button  type="button" class="btn btn-danger" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn-secondary ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>
@endsection
@section('script')
<script src="//cdn.ckeditor.com/4.14.1/standard/ckeditor.js"></script>
<script type="text/javascript">
$(document).ready(function () {
    //$('.ckeditor').ckeditor();
    //CKEDITOR.replace('post-body', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
    /*CKEDITOR.replace('media-content', {
        filebrowserUploadUrl: "{{route('media.upload', ['_token' => csrf_token() ])}}",
        filebrowserUploadMethod: 'form',
        format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'
    });*/
});

/*function readURL(input) {
  if (input.image && input.image[0]) {
    var reader = new FileReader();

    reader.onload = function(e) {
      $('#imagePreview').attr('src', e.target.result);
    }

    reader.readAsDataURL(input.files[0]);
  }
}*/
</script>
<script type="text/javascript">
var form ='';
var myurl = '{{route('form.tableData')}}';

form= $('#form_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('form.tableData')}}?source=form',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'name', name: 'name' },
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
               
                editurl = `{{ URL('admin/edit-form-builder') }}/`+row.id;
                deleteurl = `{{ route('pages.delete') }}`+'?page_id='+row.id;

                var editButton =  `<a href="`+editurl+`"  class="btn btn-primary btn-sm">Edit</a>`;

                var deleteButton = `<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#deleteModal"
                onclick="seturl('`+deleteurl+`')">
                Delete
                </button>`;
                return editButton +' '+ deleteButton;

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

$.ajaxSetup({
    headers: {
        'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
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
                form.ajax.reload();

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

