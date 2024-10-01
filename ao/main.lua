local json = require("json")

-- Initialize state
State = State or {}
State.uploadConfig = State.uploadConfig or {}

-- Helper functions
local function updateState()
    ao.send({
        Target = Sender,
        Action = "State-Update",
        Data = json.encode(State)
    })
end

-- CRUD Handlers for upload config
Handlers.add(
    "CreateUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "CreateUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        if data and type(data) == "table" then
            for key, value in pairs(data) do
                if value.txId and value.txId ~= "" then
                    State.uploadConfig[key] = value
                    print("Added/Updated upload config for: " .. key)
                end
            end
            updateState()
            ao.send({
                Target = msg.From,
                Action = "CreateUploadConfigResponse",
                Data = "Upload config created/updated"
            })
        else
            print("Error: Invalid data format in CreateUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "CreateUploadConfigResponse",
                Data = "Error: Invalid data format"
            })
        end
    end
)

Handlers.add(
    "RenameUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "RenameUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        if data and type(data) == "table" and data.oldPath and data.newPath then
            if State.uploadConfig[data.oldPath] then
                State.uploadConfig[data.newPath] = State.uploadConfig[data.oldPath]
                State.uploadConfig[data.newPath].filePath = data.newPath
                State.uploadConfig[data.oldPath] = nil
                print("Renamed upload config from " .. data.oldPath .. " to " .. data.newPath)
                updateState()
                ao.send({
                    Target = msg.From,
                    Action = "RenameUploadConfigResponse",
                    Data = "Upload config renamed"
                })
            else
                print("Error: Old path not found in upload config - " .. data.oldPath)
                ao.send({
                    Target = msg.From,
                    Action = "RenameUploadConfigResponse",
                    Data = "Error: Old path not found in upload config"
                })
            end
        else
            print("Error: Invalid data format in RenameUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "RenameUploadConfigResponse",
                Data = "Error: Invalid data format"
            })
        end
    end
)

Handlers.add(
    "GetUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "GetUploadConfig"),
    function(msg)
        local key = msg.Tags.Key
        if key then
            local value = State.uploadConfig[key]
            if value then
                print("Retrieved upload config for: " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "GetUploadConfigResponse",
                    Data = json.encode(value)
                })
            else
                print("Error: Upload config not found for key - " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "GetUploadConfigResponse",
                    Data = "Error: Upload config not found"
                })
            end
        else
            print("Sending full upload config")
            ao.send({
                Target = msg.From,
                Action = "GetUploadConfigResponse",
                Data = json.encode(State.uploadConfig)
            })
        end
    end
)

Handlers.add(
    "UpdateUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "UpdateUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        if data and type(data) == "table" then
            for key, value in pairs(data) do
                if value.txId and value.txId ~= "" then
                    State.uploadConfig[key] = value
                    print("Updated upload config for: " .. key)
                else
                    State.uploadConfig[key] = nil
                    print("Removed upload config for: " .. key)
                end
            end
            updateState()
            ao.send({
                Target = msg.From,
                Action = "UpdateUploadConfigResponse",
                Data = "Upload config updated"
            })
        else
            print("Error: Invalid data format in UpdateUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "UpdateUploadConfigResponse",
                Data = "Error: Invalid data format"
            })
        end
    end
)

Handlers.add(
    "DeleteUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "DeleteUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        local key = data.Key
        if key then
            if State.uploadConfig[key] then
                State.uploadConfig[key] = nil
                updateState()
                print("Deleted upload config for: " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "DeleteUploadConfigResponse",
                    Data = "Upload config deleted"
                })
            else
                print("Warning: Upload config not found for deletion - " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "DeleteUploadConfigResponse",
                    Data = "Warning: Upload config not found, but operation completed"
                })
            end
        else
            print("Error: Missing key in DeleteUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "DeleteUploadConfigResponse",
                Data = "Error: Missing key"
            })
        end
    end
)

Handlers.add(
    "GetState",
    Handlers.utils.hasMatchingTag("Action", "GetState"),
    function(msg)
        print("Sending full state")
        ao.send({
            Target = msg.From,
            Action = "GetStateResponse",
            Data = json.encode(State)
        })
    end
)
