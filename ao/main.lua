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
                State.uploadConfig[key] = value
            end
            updateState()
            return "Upload config created/updated"
        else
            return "Error: Invalid data format"
        end
    end
)

Handlers.add(
    "ReadUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "ReadUploadConfig"),
    function(msg)
        local key = msg.Tags.Key
        if key then
            local value = State.uploadConfig[key]
            if value then
                return json.encode(value)
            else
                return "Error: Upload config not found"
            end
        else
            return json.encode(State.uploadConfig)
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
                if State.uploadConfig[key] then
                    State.uploadConfig[key] = value
                end
            end
            updateState()
            return "Upload config updated"
        else
            return "Error: Invalid data format"
        end
    end
)

Handlers.add(
    "DeleteUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "DeleteUploadConfig"),
    function(msg)
        local key = msg.Tags.Key
        if key then
            if State.uploadConfig[key] then
                State.uploadConfig[key] = nil
                updateState()
                return "Upload config deleted"
            else
                return "Error: Upload config not found"
            end
        else
            return "Error: Missing key"
        end
    end
)

Handlers.add(
    "GetState",
    Handlers.utils.hasMatchingTag("Action", "GetState"),
    function(msg)
        return json.encode(State)
    end
)
