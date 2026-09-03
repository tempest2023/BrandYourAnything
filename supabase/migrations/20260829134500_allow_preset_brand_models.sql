-- Built-in Brand Anything models are served from versioned public assets, so
-- their campaign rows store a trusted preset identifier instead of a private
-- Storage object path. Keep the identifier and file name paired to prevent an
-- arbitrary preset:* value from bypassing the signed-upload path checks.

alter table public.ba_dev_campaign_assets
  drop constraint ba_dev_campaign_assets_model_file_check;

alter table public.ba_dev_campaign_assets
  add constraint ba_dev_campaign_assets_model_file_check check (
    (asset_type = 'laptop' and model_storage_path is null and model_file_name is null)
    or
    (asset_type = 'anything'
      and model_storage_path is not null
      and model_file_name is not null
      and (
        (
          model_storage_path ~* '^[a-f0-9]{16}/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.(glb|gltf|obj|fbx|stl|ply)$'
          and lower(model_file_name) ~ '\.(glb|gltf|obj|fbx|stl|ply)$'
        )
        or
        (model_storage_path, model_file_name) in (
          ('preset:tesla-model-3', 'tesla-model-3.glb'),
          ('preset:tesla-cybertruck', 'tesla-cybertruck.glb'),
          ('preset:flybridge-yacht', 'flybridge-yacht.glb'),
          ('preset:private-jet', 'private-jet.glb')
        )
      ))
  );

alter table public.ba_prod_campaign_assets
  drop constraint ba_prod_campaign_assets_model_file_check;

alter table public.ba_prod_campaign_assets
  add constraint ba_prod_campaign_assets_model_file_check check (
    (asset_type = 'laptop' and model_storage_path is null and model_file_name is null)
    or
    (asset_type = 'anything'
      and model_storage_path is not null
      and model_file_name is not null
      and (
        (
          model_storage_path ~* '^[a-f0-9]{16}/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.(glb|gltf|obj|fbx|stl|ply)$'
          and lower(model_file_name) ~ '\.(glb|gltf|obj|fbx|stl|ply)$'
        )
        or
        (model_storage_path, model_file_name) in (
          ('preset:tesla-model-3', 'tesla-model-3.glb'),
          ('preset:tesla-cybertruck', 'tesla-cybertruck.glb'),
          ('preset:flybridge-yacht', 'flybridge-yacht.glb'),
          ('preset:private-jet', 'private-jet.glb')
        )
      ))
  );
